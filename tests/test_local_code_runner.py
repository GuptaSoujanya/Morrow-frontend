"""Real local-runtime checks. These never invoke AI or access user data."""
import json
import os
from pathlib import Path
import socket
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import local_code_runner as runner


@pytest.fixture
def supported():
    value = runner.capabilities()
    if not value['available']:
        pytest.skip(value['reason'])
    return value


def run(code, language='python', **kwargs):
    return runner.execute({'language': language, 'code': code, 'stdin': '{"values":[1,2,3]}', **kwargs})


def test_capabilities_never_offer_unsandboxed_fallback(monkeypatch):
    monkeypatch.setattr(runner, '_probe', lambda: (False, 'Sandbox unavailable'))
    value = runner.capabilities()
    assert not value['available'] and not any(item['available'] for item in value['languages'])
    assert run('def solve(data): return 1')['status'] == 'unavailable'


@pytest.mark.parametrize('payload', [{}, {'language': 'sh', 'code': 'echo hi'},
    {'language': 'python', 'code': ''}, {'language': 'python', 'code': 'x' * 100001},
    {'language': 'python', 'code': 'pass', 'stdin': 'not json'},
    {'language': 'python', 'code': 'pass', 'stdin': 'NaN'},
    {'language': 'python', 'code': 'pass', 'stdin': '1e999'},
    {'language': 'python', 'code': 'pass', 'stdin': '[' * 2000 + ']' * 2000}])
def test_invalid_input_rejected_before_launch(payload):
    with pytest.raises(ValueError):
        runner.execute(payload)


@pytest.mark.parametrize('language,code', [('python', 'def solve(data): return sum(data["values"])'),
    ('javascript', 'function solve(data) { return data.values.reduce((a,b) => a+b, 0); }'),
    ('cpp', '#include <iostream>\nint main(){ std::cout << 6; }')])
def test_real_languages_return_stdout(supported, language, code):
    if not next(item['available'] for item in supported['languages'] if item['id'] == language):
        pytest.skip(f'{language} not installed')
    result = run(code, language)
    assert result['status'] == 'ok', result
    assert json.loads(result['stdout']) == 6


def test_runtime_errors_fail_and_debug_output_does_not_corrupt_return_value(supported):
    error = run('def solve(data): raise ValueError("Try a valid index")')
    assert error['status'] == 'runtime_error' and 'Try a valid index' in error['stderr']
    result = runner.execute({'language': 'python', 'code': 'def solve(data):\n print("debug")\n return 6'},
        tests=[{'id': 'sample', 'input': {}, 'expected': 6}])
    assert result['passed'] == 1 and result['tests'][0]['status'] == 'accepted'
    assert result['tests'][0]['debug_stdout'] == 'debug\n'
    assert result['tests'][0]['actual'] == 6


def test_compile_error(supported):
    result = run('not a C++ program', 'cpp')
    assert result['status'] == 'compile_error' and 'error' in result['stderr']


def test_parent_judges_each_case_and_strict_types(supported):
    result = runner.execute({'language': 'python', 'code': 'def solve(data): return data["value"]'}, tests=[
        {'id': 'one', 'input': {'value': 3}, 'expected': 3},
        {'id': 'two', 'input': {'value': True}, 'expected': 1},
        {'id': 'three', 'input': {'value': [2, 1]}, 'expected': [1, 2], 'comparison': 'unordered'}])
    assert result['status'] == 'failed' and result['passed'] == 2 and result['total'] == 3
    assert [item['passed'] for item in result['tests']] == [True, False, True]
    assert result['verdict'] == result['tests'][1]['status'] == 'wrong_answer'
    assert result['tests'][1]['input'] == {'value': True}
    assert result['runtime_ms'] > 0 and result['peak_memory_bytes'] > 0


@pytest.mark.parametrize('language,source', [
    ('python', 'def solve(input):\n    pass'),
    ('javascript', 'function solve(input) {}'),
    ('cpp', 'int main() {}'),
])
def test_unimplemented_solution_never_passes_a_boolean_test(supported, language, source):
    result = runner.execute({'language': language, 'code': source},
                            tests=[{'id': 'empty', 'input': {}, 'expected': True}])
    assert result['passed'] == 0 and result['status'] == 'failed'
    assert result['tests'][0]['status'] != 'ok'


@pytest.mark.parametrize('language,source', [
    ('python', 'def solve(input):\n print("true")\n return "true"'),
    ('javascript', 'function solve(input) { console.log(true); return "true"; }'),
])
def test_printed_correct_answer_cannot_hide_incorrect_return_type(supported, language, source):
    result = runner.execute({'language': language, 'code': source},
                            tests=[{'id': 'types', 'input': {}, 'expected': True}])
    assert result['verdict'] == 'wrong_answer' and result['passed'] == 0
    assert result['tests'][0]['actual'] == 'true'
    assert result['tests'][0]['debug_stdout'].strip() == 'true'


def test_exiting_without_return_cannot_reuse_previous_case_answer(supported):
    source = 'import os\ndef solve(input):\n if input["stop"]: os._exit(0)\n return 7'
    result = runner.execute({'language': 'python', 'code': source}, tests=[
        {'id': 'returned', 'input': {'stop': False}, 'expected': 7},
        {'id': 'missing', 'input': {'stop': True}, 'expected': 7}])
    assert result['passed'] == 1
    assert result['tests'][1]['status'] == 'invalid_output'


@pytest.mark.parametrize('kind', ['symlink', 'fifo'])
def test_return_channel_cannot_read_a_link_or_block_on_a_pipe(supported, kind):
    source = ('import os, sys\ndef solve(input):\n path = sys.argv[2]\n os.unlink(path)\n '
              + ('os.symlink("/etc/passwd", path)' if kind == 'symlink' else 'os.mkfifo(path)')
              + '\n os._exit(0)')
    result = run(source)
    assert result['status'] == 'invalid_output'
    assert result['stdout'] == ''


def test_slow_exponential_solution_hits_limit_on_larger_inputs(supported):
    import code_problem_catalog as catalog
    source = 'def solve(input):\n def stairs(n):\n  return 1 if n <= 1 else stairs(n-1) + stairs(n-2)\n return stairs(input["n"])'
    result = runner.execute({'language': 'python', 'code': source}, tests=catalog.cases('09-dynamic-programming/problem-1'))
    assert result['status'] == 'failed'
    assert any(case['status'] == 'timeout' and case['category'] == 'stress' for case in result['tests'])
    assert result['passed'] < result['total']


def test_timeout_and_output_limits(supported):
    result = run('def solve(data):\n while True: pass')
    assert result['status'] == 'timeout', result
    result = run('def solve(data):\n print("x" * 100000)\n return 1')
    assert result['status'] == 'output_limit'
    assert len(result['stdout'].encode()) + len(result['stderr'].encode()) <= runner.OUTPUT_LIMIT


def test_sandbox_blocks_workspace_reads_network_and_process_forks(supported, tmp_path):
    secret = tmp_path / 'private-source.txt'
    secret.write_text('not available to submitted programs')
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    source = f'''import os, socket
def solve(data):
 result = {{}}
 try:
  open({str(secret)!r}).read()
  result['files'] = 'allowed'
 except OSError:
  result['files'] = 'blocked'
 try:
  socket.create_connection(('127.0.0.1', {port}), timeout=0.2)
  result['network'] = 'allowed'
 except OSError:
  result['network'] = 'blocked'
 result['env'] = 'OPENAI_API_KEY' not in os.environ and 'USER' not in os.environ
 if hasattr(os, 'fork'):
  try:
   child = os.fork()
   if child == 0: os._exit(0)
   os.waitpid(child, 0)
   result['fork'] = 'allowed'
  except OSError:
   result['fork'] = 'blocked'
 return result
'''
    try:
        result = run(source)
    finally:
        listener.close()
    assert result['status'] == 'ok', result
    actual = json.loads(result['stdout'])
    assert actual['files'] == actual['network'] == 'blocked' and actual['env']
    if supported['isolation'] == 'macos-seatbelt':
        assert actual['fork'] == 'blocked'


def test_fresh_process_for_each_case(supported):
    result = runner.execute({'language': 'python', 'code': 'counter = 0\ndef solve(data):\n global counter\n counter += 1\n return counter'},
        tests=[{'id': 'first', 'input': {}, 'expected': 1}, {'id': 'second', 'input': {}, 'expected': 1}])
    assert result['status'] == 'accepted' and result['passed'] == 2


def test_nonfinite_program_output_is_rejected(supported):
    result = runner.execute({'language': 'python', 'code': 'def solve(data):\n print("1e999")\n raise SystemExit(0)'},
        tests=[{'id': 'finite', 'input': {}, 'expected': 1}])
    assert result['tests'][0]['status'] == 'invalid_output' and result['tests'][0]['actual'] is None
    json.dumps(result, allow_nan=False)


def test_memory_limit_terminates_growing_process(supported):
    result = run('import time\ndef solve(data):\n chunks = []\n while True:\n  chunks.append(bytearray(16 * 1024 * 1024))\n  time.sleep(0.01)')
    assert result['status'] == 'memory_limit', result


def test_cancellation_cleans_up_child_process(supported, monkeypatch):
    captured = []
    original = runner.subprocess.Popen
    def launch(*args, **kwargs):
        process = original(*args, **kwargs)
        captured.append(process)
        return process
    def interrupted(pid):
        raise KeyboardInterrupt()
    monkeypatch.setattr(runner.subprocess, 'Popen', launch)
    monkeypatch.setattr(runner, '_resident_memory', interrupted)
    with pytest.raises(KeyboardInterrupt):
        run('import time\ndef solve(data): time.sleep(30)')
    assert len(captured) == 1 and captured[0].returncode is not None
    with pytest.raises(ProcessLookupError):
        os.kill(captured[0].pid, 0)


def test_timeout_stops_remaining_cases(supported):
    result = runner.execute({'language': 'python', 'code': 'def solve(data):\n while True: pass'},
        tests=[{'id': 'first', 'input': {}, 'expected': 1}, {'id': 'next', 'input': {}, 'expected': 1}])
    assert result['passed'] == 0 and result['tests'][0]['status'] == 'timeout'
    assert result['tests'][1]['status'] == 'not_run'


def test_unavailable_case_keeps_entire_submission_unscorable(monkeypatch):
    monkeypatch.setattr(runner, 'capabilities', lambda: {'languages': [{'id': 'python', 'available': True}]})
    calls = []
    def failed(*args, **kwargs):
        calls.append(True)
        return {'status': 'unavailable', 'stdout': '', 'stderr': 'The runtime could not start.', 'duration_ms': 1, 'exit_code': None}
    monkeypatch.setattr(runner, '_run', failed)
    result = runner.execute({'language': 'python', 'code': 'def solve(data): return 1'},
        tests=[{'id': 'first', 'input': {}, 'expected': 1}, {'id': 'second', 'input': {}, 'expected': 1}])
    assert result['status'] == 'unavailable' and len(calls) == 1
    assert result['tests'][0]['status'] == 'unavailable' and result['tests'][1]['status'] == 'not_run'
    assert 'could not start' in result['stderr']


def test_missing_executable_is_infrastructure_failure(supported):
    with runner._workspace() as directory:
        workspace = Path(directory).resolve()
        result = runner._run(runner._command(runner._backend(), workspace, [str(workspace / 'missing-program')]), workspace)
    assert result['status'] == 'unavailable', result


def test_cpp_starter_reads_named_json_fields_and_returns_algorithm_result(supported):
    import code_problem_catalog as catalog
    identifier = next(identifier for identifier in catalog.ids() if catalog.problem(identifier)['title'] == 'Two Sum')
    starter = catalog.problem(identifier)['starter']['cpp']
    source = starter.replace('throw std::runtime_error("Write your solution here");', '''auto nums = input.at("nums").get<std::vector<int>>();
    int target = input.at("target").get<int>();
    for (std::size_t i = 0; i < nums.size(); ++i) {
        for (std::size_t j = i + 1; j < nums.size(); ++j) {
            if (nums[i] + nums[j] == target) return json::array({i, j});
        }
    }
    return json::array();''')
    result = runner.execute({'language': 'cpp', 'code': source}, tests=catalog.cases(identifier))
    assert result['status'] == 'accepted' and result['passed'] == result['total'] == len(catalog.cases(identifier)), result


def test_bundled_cpp_header_matches_official_pinned_release():
    import hashlib
    assert hashlib.sha256(runner.CPP_HEADER.read_bytes()).hexdigest() == 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'
    assert 'MIT License' in runner.CPP_HEADER.with_name('LICENSE.MIT').read_text()


def test_concurrent_requests_use_independent_limited_processes(supported):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda value: run('def solve(data): return data["value"] * 2',
            stdin=json.dumps({'value': value})), range(8)))
    assert all(result['status'] == 'ok' for result in results), results
    assert [json.loads(result['stdout']) for result in results] == [value * 2 for value in range(8)]


def test_limit_launcher_cannot_import_workspace_sitecustomize(supported):
    with runner._workspace() as directory:
        workspace = Path(directory).resolve()
        (workspace / 'sitecustomize.py').write_text('raise RuntimeError("workspace customization was imported")')
        (workspace / 'resource.py').write_text('raise RuntimeError("workspace resource module was imported")')
        result = runner._run(runner._command(runner._backend(), workspace, ['/usr/bin/true']), workspace)
    assert result['status'] == 'ok', result
