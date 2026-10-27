"""Run learning exercises locally, inside an OS filesystem/network sandbox.

There is deliberately no unsandboxed fallback. Python and JavaScript implement
``solve(input)``; C++ programs consume JSON on stdin and print JSON on stdout.
Judging happens in this parent process, outside the submitted program.
"""
from __future__ import annotations

import ctypes
import functools
import json
import math
import os
from pathlib import Path
import platform
import selectors
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time


CODE_LIMIT = 100_000
INPUT_LIMIT = 100_000
OUTPUT_LIMIT = 64_000
WALL_SECONDS = 3
COMPILE_SECONDS = 15
MEMORY_BYTES = 384 * 1024 * 1024
MAX_TESTS = 24
TOTAL_SECONDS = 30
LANGUAGES = {'python': 'Python 3', 'javascript': 'JavaScript', 'cpp': 'C++17'}
CPP_HEADER = Path(__file__).resolve().parent / 'vendor/nlohmann/json.hpp'


def _runtime_paths():
    if platform.system() == 'Darwin':
        python = '/Library/Developer/CommandLineTools/usr/bin/python3'
        compiler = '/Library/Developer/CommandLineTools/usr/bin/clang++'
        return {'python': python if Path(python).is_file() else shutil.which('python3'),
                'javascript': shutil.which('node'),
                'cpp': compiler if Path(compiler).is_file() else shutil.which('clang++')}
    return {'python': shutil.which('python3'), 'javascript': shutil.which('node'),
            'cpp': shutil.which('g++') or shutil.which('clang++')}


def _backend():
    system = platform.system()
    if system == 'Darwin' and Path('/usr/bin/sandbox-exec').is_file():
        return 'macos-seatbelt'
    if system == 'Linux' and shutil.which('bwrap'):
        return 'linux-bubblewrap'
    return ''


def _profile(workspace, compile=False):
    # Metadata alone cannot expose file contents. It allows the system loader
    # to inspect ancestor directories before opening the explicitly allowed files.
    paths = ['/usr', '/bin', '/System', '/Library/Developer', '/Library/Apple',
             '/private/var/db/dyld', '/private/preboot/Cryptexes/OS', '/opt/homebrew', str(workspace)]
    reads = ' '.join('(subpath ' + json.dumps(path) + ')' for path in paths)
    return ('(version 1)(deny default)'
            '(allow process-exec)' + ('(allow process-fork)' if compile else '') +
            '(allow signal (target self))'
            '(allow sysctl-read)(allow file-read-metadata)'
            '(allow file-read* ' + reads +
            ' (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))'
            '(allow file-write* (subpath ' + json.dumps(str(workspace)) + ') (literal "/dev/null"))'
            '(allow mach-lookup (global-name "com.apple.system.logger"))')


def _command(backend, workspace, command, *, compile=False):
    if backend == 'macos-seatbelt':
        return ['/usr/bin/sandbox-exec', '-p', _profile(workspace, compile), *command]
    if backend == 'linux-bubblewrap':
        args = [shutil.which('bwrap'), '--unshare-all', '--die-with-parent', '--new-session']
        if not compile:
            args += ['--seccomp', 'MORROW_SECCOMP_FD']
        for directory in ('/usr', '/bin', '/sbin', '/lib', '/lib64'):
            if Path(directory).exists():
                args += ['--ro-bind', directory, directory]
        args += ['--proc', '/proc', '--dev', '/dev', '--dir', '/etc']
        for filename in ('/etc/ld.so.cache', '/etc/localtime'):
            if Path(filename).exists():
                args += ['--ro-bind', filename, filename]
        args += ['--bind', str(workspace), str(workspace), '--chdir', str(workspace), '--', *command]
        return args
    raise RuntimeError('A supported operating-system sandbox is required.')


def _environment(workspace):
    return {'PATH': '/usr/bin:/bin:/usr/local/bin', 'HOME': str(workspace),
            'TMPDIR': str(workspace), 'TMP': str(workspace), 'TEMP': str(workspace),
            'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8',
            'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}


# This static launcher runs before the OS sandbox, but never imports or executes
# a submitted file. A new interpreter with -I -S excludes cwd, user site packages,
# environment configuration, and site customization. This avoids preexec_fn in a
# threaded HTTP server, where inherited Python locks could otherwise deadlock.
_LIMIT_LAUNCHER = '''import os, resource, sys
try:
    compiling = sys.argv[1] == '1'
    cpu = 12 if compiling else 2
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16777216, 16777216))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if compiling and hasattr(resource, 'RLIMIT_AS') and sys.platform != 'darwin':
        resource.setrlimit(resource.RLIMIT_AS, (1610612736, 1610612736))
    os.execv(sys.argv[2], sys.argv[2:])
except (OSError, ValueError) as error:
    sys.stderr.write('morrow-launcher: ' + str(error) + '\\n')
    sys.exit(78)
'''


@functools.lru_cache(maxsize=1)
def _proc_library():
    if platform.system() == 'Darwin':
        library = ctypes.CDLL('/usr/lib/libproc.dylib')
        library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        library.proc_pidinfo.restype = ctypes.c_int
        library.proc_listchildpids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        library.proc_listchildpids.restype = ctypes.c_int
        return library
    return None


def _resident_memory(pid):
    try:
        library = _proc_library()
        if library:
            data = ctypes.create_string_buffer(96)
            if library.proc_pidinfo(pid, 4, 0, data, 96) >= 16:
                return ctypes.c_uint64.from_buffer(data, 8).value
        else:
            for line in Path(f'/proc/{pid}/status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError):
        pass
    return 0


def _process_tree(pid):
    pending, found = [pid], []
    library = _proc_library()
    while pending and len(found) <= 32:
        current = pending.pop()
        if current in found:
            continue
        found.append(current)
        try:
            if library:
                children = (ctypes.c_int * 64)()
                size = library.proc_listchildpids(current, children, ctypes.sizeof(children))
                pending.extend(child for child in children[:max(0, size) // ctypes.sizeof(ctypes.c_int)] if child > 0)
            else:
                pending.extend(map(int, Path(f'/proc/{current}/task/{current}/children').read_text().split()))
        except (OSError, ValueError):
            pass
    return found


def _seccomp_filter():
    """Linux BPF: allow threads, reject process forks and clone3.

    Returning ENOSYS for clone3 lets libc/Node use their traditional clone path,
    where CLONE_THREAD can be checked. An unexpected syscall ABI is rejected.
    """
    machine = platform.machine().lower()
    if machine in ('x86_64', 'amd64'):
        architecture, clone, forks = 0xC000003E, 56, (57, 58)
    elif machine in ('aarch64', 'arm64'):
        architecture, clone, forks = 0xC00000B7, 220, ()
    else:
        raise RuntimeError('Local execution supports only 64-bit x86 and ARM Linux.')
    # sock_filter: code (u16), true jump (u8), false jump (u8), value (u32).
    instructions = [(0x20, 0, 0, 4), (0x15, 1, 0, architecture), (0x06, 0, 0, 0x80000000),
                    (0x20, 0, 0, 0)]
    # x32 uses the same arch tag with a syscall-number flag; deny that ABI.
    instructions += [(0x45, 0, 1, 0x40000000), (0x06, 0, 0, 0x80000000)]
    for syscall in forks:
        instructions += [(0x15, 0, 1, syscall), (0x06, 0, 0, 0x00050001)]
    instructions += [(0x15, 0, 1, 435), (0x06, 0, 0, 0x00050026),
                     (0x15, 0, 3, clone), (0x20, 0, 0, 16),
                     (0x45, 1, 0, 0x00010000), (0x06, 0, 0, 0x00050001),
                     (0x06, 0, 0, 0x7FFF0000)]
    return b''.join(struct.pack('HBBI', *instruction) for instruction in instructions)


def _kill(process):
    # Linux bubblewrap creates a second session; explicitly kill descendants
    # before killing the launcher. Runtime forks are denied, compiler forks are
    # confined to its PID namespace and temporary workspace.
    for pid in reversed(_process_tree(process.pid)[1:]):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _run(command, workspace, stdin='', *, compile=False):
    started = time.monotonic()
    deadline = started + (COMPILE_SECONDS if compile else WALL_SECONDS)
    process = None
    result = {'status': 'ok', 'stdout': '', 'stderr': '', 'duration_ms': 0, 'exit_code': None, 'peak_memory_bytes': None}
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    selector = selectors.DefaultSelector()
    seccomp = None
    try:
        pass_fds = ()
        if 'MORROW_SECCOMP_FD' in command:
            seccomp = tempfile.TemporaryFile()
            seccomp.write(_seccomp_filter())
            seccomp.seek(0)
            command = [str(seccomp.fileno()) if item == 'MORROW_SECCOMP_FD' else item for item in command]
            pass_fds = (seccomp.fileno(),)
        isolated_command = [str(Path(sys.executable).resolve()), '-I', '-S', '-B', '-c',
                            _LIMIT_LAUNCHER, '1' if compile else '0', *command]
        process = subprocess.Popen(isolated_command, cwd=str(workspace), env=_environment(workspace),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True, close_fds=True, pass_fds=pass_fds)
        for name, pipe in (('stdout', process.stdout), ('stderr', process.stderr)):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        os.set_blocking(process.stdin.fileno(), False)
        data = stdin.encode('utf-8')
        if data:
            selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
        else:
            process.stdin.close()
        offset = 0
        while selector.get_map():
            if time.monotonic() > deadline:
                result['status'] = 'timeout'
                break
            descendants = _process_tree(process.pid)
            if len(descendants) > 32:
                result['status'] = 'process_limit'
                break
            memory = sum(_resident_memory(pid) for pid in descendants)
            if memory:
                result['peak_memory_bytes'] = max(result['peak_memory_bytes'] or 0, memory)
            if memory > MEMORY_BYTES * (3 if compile else 1):
                result['status'] = 'memory_limit'
                break
            for key, _ in selector.select(timeout=0.025):
                if key.data == 'stdin':
                    try:
                        offset += os.write(key.fd, data[offset:offset + 8192])
                    except (BrokenPipeError, OSError):
                        offset = len(data)
                    if offset == len(data):
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    continue
                try:
                    chunk = os.read(key.fd, 8192)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                remaining = OUTPUT_LIMIT - sum(map(len, streams.values()))
                streams[key.data].extend(chunk[:max(0, remaining)])
                if len(chunk) > remaining:
                    result['status'] = 'output_limit'
                    break
            if result['status'] != 'ok':
                break
        if result['status'] != 'ok':
            _kill(process)
        else:
            try:
                process.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                result['status'] = 'timeout'
                _kill(process)
        result['exit_code'] = process.returncode
        if result['status'] == 'ok' and process.returncode:
            stderr = streams['stderr'].decode('utf-8', errors='replace').lstrip()
            # These diagnostics come from the OS sandbox launcher, before the
            # submitted program can start. A broken sandbox is not a failed test.
            launcher_failure = stderr.startswith(('morrow-launcher:', 'sandbox-exec:', 'bwrap:', 'dyld['))
            result['status'] = ('unavailable' if launcher_failure else
                'timeout' if process.returncode == -signal.SIGXCPU else 'runtime_error')
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        result['status'] = 'unavailable'
        streams['stderr'].extend(str(error).encode()[:OUTPUT_LIMIT])
    finally:
        selector.close()
        if seccomp:
            seccomp.close()
        if process:
            # Also clean descendants if the main program exited first.
            _kill(process)
            for pipe in (process.stdin, process.stdout, process.stderr):
                if pipe and not pipe.closed:
                    pipe.close()
    result.update({name: value.decode('utf-8', errors='replace') for name, value in streams.items()})
    result['duration_ms'] = round((time.monotonic() - started) * 1000)
    return result


def _workspace():
    return tempfile.TemporaryDirectory(prefix='morrow-code-', dir='/private/tmp' if platform.system() == 'Darwin' else '/tmp')


@functools.lru_cache(maxsize=1)
def _probe():
    backend = _backend()
    if not backend:
        return False, 'Local execution requires macOS sandbox-exec or Linux bubblewrap (bwrap).'
    with _workspace() as directory:
        workspace = Path(directory).resolve()
        result = _run(_command(backend, workspace, ['/usr/bin/true']), workspace)
    if result['status'] != 'ok':
        return False, 'The operating-system sandbox could not start. ' + (result['stderr'].strip()[:240] or 'Check local sandbox permissions.')
    return True, ''


def capabilities():
    available, reason = _probe()
    runtimes = _runtime_paths()
    return {'available': available, 'isolation': _backend(), 'reason': reason,
        'languages': [{'id': language, 'label': label, 'available': bool(available and runtimes[language]),
                       'reason': reason if not available else ('' if runtimes[language] else f'{label} is not installed.')}
                      for language, label in LANGUAGES.items()],
        'limits': {'time_seconds': WALL_SECONDS, 'compile_seconds': COMPILE_SECONDS,
                   'memory_mb': MEMORY_BYTES // (1024 * 1024), 'output_bytes': OUTPUT_LIMIT,
                   'code_bytes': CODE_LIMIT},
        'protocol': 'Define solve(input) and return a JSON value. C++17 includes nlohmann/json 3.12.0; the starter reads stdin and prints the result. Standalone C++ stdin/stdout programs also work.'}


_PYTHON_WRAPPER = '''import json, sys
from solution import solve
value = json.loads(sys.stdin.read() or '{}')
result = solve(value)
with open(sys.argv[2], 'w') as output:
    json.dump(result, output, allow_nan=False, separators=(',', ':'))
'''

_JAVASCRIPT_WRAPPER = '''\n; Promise.resolve(solve(JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}'))).then(value => {
  const output = JSON.stringify(value);
  if (output === undefined) throw new Error('solve(input) must return a JSON value');
  require('fs').writeFileSync(process.argv[2], output);
}).catch(error => { console.error(error && error.stack || String(error)); process.exitCode = 1; });
'''


def _returned_output(result, path):
    """Read the return channel without confusing debug prints with the answer.

    The child owns this path: never follow links, block on a pipe, or read an
    unbounded file in the trusted parent. A missing return is not JSON null.
    """
    result['debug_stdout'] = result['stdout']
    result['stdout'] = ''
    if result['status'] != 'ok':
        return
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise ValueError('No regular result file.')
            if info.st_size > OUTPUT_LIMIT:
                result['status'] = 'output_limit'
                return
            data = stream.read(OUTPUT_LIMIT + 1)
        if len(data) + len(result['debug_stdout'].encode()) + len(result['stderr'].encode()) > OUTPUT_LIMIT:
            result['status'] = 'output_limit'
            return
        result['stdout'] = data.decode('utf-8')
        _strict_json(result['stdout'])
    except (OSError, ValueError, TypeError, RecursionError):
        result['status'] = 'invalid_output'


def _json_input(value):
    result = json.dumps(value, allow_nan=False, separators=(',', ':'))
    if len(result.encode()) > INPUT_LIMIT:
        raise ValueError('Input exceeds the 100 KB limit.')
    return result


def _strict_json(text):
    def invalid(value):
        raise ValueError('Non-finite numbers are not valid JSON output.')
    value = json.loads(text, parse_constant=invalid)
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > 128:
            raise ValueError('JSON nesting exceeds the supported limit.')
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError('Non-finite numbers are not valid JSON output.')
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
    return value


def execute(payload, tests=None):
    """Execute one draft or judge a server-owned list of cases.

    Payload values are data, never shell text. Callers must not accept expected
    outputs or test cases from a client when awarding progress or scores.
    """
    if not isinstance(payload, dict):
        raise ValueError('Provide a code execution object.')
    language, code = payload.get('language'), payload.get('code')
    if language not in LANGUAGES:
        raise ValueError('Choose Python, JavaScript, or C++.')
    if not isinstance(code, str) or not code.strip() or len(code.encode()) > CODE_LIMIT:
        raise ValueError('Provide code between 1 byte and 100 KB.')
    if tests is None:
        stdin = payload.get('stdin', '{}')
        if not isinstance(stdin, str) or len(stdin.encode()) > INPUT_LIMIT:
            raise ValueError('Input must be JSON text up to 100 KB.')
        try:
            inputs = [(None, _json_input(_strict_json(stdin or '{}')))]
        except (ValueError, TypeError, OverflowError, RecursionError) as error:
            raise ValueError('Custom input must be valid JSON.') from error
    else:
        if not isinstance(tests, list) or not 1 <= len(tests) <= MAX_TESTS:
            raise ValueError(f'Provide between 1 and {MAX_TESTS} trusted test cases.')
        inputs = [(case, _json_input(case['input'])) for case in tests]
    supported = capabilities()
    selected = next(item for item in supported['languages'] if item['id'] == language)
    if not selected['available']:
        return {'status': 'unavailable', 'stdout': '', 'stderr': selected['reason'], 'duration_ms': 0, 'exit_code': None}
    backend, runtimes = _backend(), _runtime_paths()
    if not runtimes.get(language):
        return {'status': 'unavailable', 'stdout': '', 'stderr': f'{LANGUAGES[language]} is no longer available. Check its local installation.', 'duration_ms': 0, 'exit_code': None}
    started = time.monotonic()
    with _workspace() as directory:
        workspace = Path(directory).resolve()
        returned = workspace / 'returned.json'
        if language == 'python':
            (workspace / 'solution.py').write_text(code)
            (workspace / 'main.py').write_text(_PYTHON_WRAPPER)
            # -I excludes cwd; explicitly add this new workspace before loading the harness.
            command = [runtimes[language], '-I', '-B', '-c',
                       'import sys; sys.path.insert(0, sys.argv[1]); import main', str(workspace), str(returned)]
        elif language == 'javascript':
            (workspace / 'main.cjs').write_text(code + _JAVASCRIPT_WRAPPER)
            command = [runtimes[language], '--max-old-space-size=192', str(workspace / 'main.cjs'), str(returned)]
        else:
            try:
                (workspace / 'nlohmann').mkdir()
                shutil.copyfile(CPP_HEADER, workspace / 'nlohmann/json.hpp')
            except OSError:
                return {'status': 'unavailable', 'stdout': '', 'stderr': 'The bundled C++ JSON header is unavailable. Restore vendor/nlohmann/json.hpp.', 'duration_ms': 0, 'exit_code': None}
            (workspace / 'main.cpp').write_text(code)
            sdk = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk')
            sdk_flags = ['-isysroot', str(sdk)] if platform.system() == 'Darwin' and sdk.is_dir() else []
            compiled = _run(_command(backend, workspace,
                [runtimes[language], '-std=c++17', '-O1', '-I', str(workspace), *sdk_flags, '-fno-color-diagnostics' if 'clang' in runtimes[language] else '-fdiagnostics-color=never',
                 str(workspace / 'main.cpp'), '-o', str(workspace / 'program')], compile=True), workspace, compile=True)
            if compiled['status'] != 'ok':
                if compiled['status'] == 'runtime_error':
                    compiled['status'] = 'compile_error'
                return compiled
            command = [str(workspace / 'program')]
        outcomes = []
        for case, stdin in inputs:
            # Cases use fresh processes and fresh return channels. An empty
            # channel cannot inherit an answer from an earlier execution.
            if language != 'cpp':
                descriptor, path = tempfile.mkstemp(prefix='returned-', suffix='.json', dir=workspace)
                os.close(descriptor)
                returned = Path(path)
                command[-1] = str(returned)
            result = _run(_command(backend, workspace, command), workspace, stdin)
            if language != 'cpp':
                _returned_output(result, returned)
            if case is None:
                if result['status'] == 'ok':
                    try:
                        result['actual'] = _strict_json(result['stdout'].strip())
                    except (ValueError, TypeError, RecursionError):
                        result['status'] = 'invalid_output'
                result['judged'] = False
                return result
            actual = None
            if result['status'] == 'ok':
                try:
                    actual = _strict_json(result['stdout'].strip())
                except (ValueError, TypeError, RecursionError):
                    result['status'] = 'invalid_output'
            from code_problem_catalog import matches
            passed = result['status'] == 'ok' and matches(actual, case['expected'], case.get('comparison', 'exact'))
            if result['status'] == 'ok':
                result['status'] = 'accepted' if passed else 'wrong_answer'
            outcomes.append({**result, 'id': case['id'], 'name': case.get('name', case['id']),
                             'category': case.get('category', 'sample' if case.get('sample') else 'edge'), 'size': case.get('size'),
                             'input': case['input'], 'comparison': case.get('comparison', 'exact'),
                             'passed': passed, 'actual': actual, 'expected': case['expected']})
            # Repeated infinite loops should not multiply the wall-time budget.
            if result['status'] in ('timeout', 'memory_limit', 'output_limit', 'process_limit', 'unavailable') or time.monotonic() - started > TOTAL_SECONDS - WALL_SECONDS:
                outcomes.extend({'id': pending['id'], 'name': pending.get('name', pending['id']),
                    'category': pending.get('category', 'edge'), 'input': pending['input'],
                    'passed': False, 'status': 'not_run', 'actual': None,
                    'expected': pending['expected'], 'stdout': '', 'stderr': 'Stopped after an execution limit.', 'duration_ms': 0,
                    'exit_code': None} for pending, _ in inputs[len(outcomes):])
                break
        passed = sum(item['passed'] for item in outcomes)
        unavailable = next((item for item in outcomes if item['status'] == 'unavailable'), None)
        failure = next((item for item in outcomes if not item['passed']), None)
        return {'status': 'unavailable' if unavailable else 'accepted' if passed == len(outcomes) else 'failed', 'passed': passed,
                'verdict': 'unavailable' if unavailable else failure['status'] if failure else 'accepted', 'judged': True,
                'total': len(outcomes), 'tests': outcomes, 'stdout': outcomes[0]['stdout'],
                'stderr': unavailable['stderr'] if unavailable else '',
                'duration_ms': sum(item['duration_ms'] for item in outcomes),
                'runtime_ms': max(item['duration_ms'] for item in outcomes),
                'peak_memory_bytes': max((item.get('peak_memory_bytes') or 0 for item in outcomes), default=0) or None,
                'language': language}
