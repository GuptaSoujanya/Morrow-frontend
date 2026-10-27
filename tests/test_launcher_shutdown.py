"""Launcher shutdown checks use fake apps and children, never real services."""
import importlib.util
import json
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('dashboard_shutdown_test', ROOT / 'server.py')
dashboard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dashboard
spec.loader.exec_module(dashboard)


@pytest.fixture
def fake_main(monkeypatch):
    original = {signal.SIGINT: object(), signal.SIGTERM: object()}
    handlers = dict(original)
    calls = []

    def install(signum, handler):
        previous = handlers[signum]
        handlers[signum] = handler
        return previous

    app = SimpleNamespace(
        serve_forever=lambda: calls.append('serve'),
        runner=SimpleNamespace(shutdown=lambda: calls.append('runner shutdown')),
        server_close=lambda: calls.append('server close'))
    monkeypatch.setattr(signal, 'signal', install)
    monkeypatch.setattr(dashboard, 'launch_options', lambda: SimpleNamespace(port=0, account_url=None, mode='beta'))
    monkeypatch.setattr(dashboard, 'register_actions', lambda: None)
    monkeypatch.setattr(dashboard, 'DashboardServer', lambda *args: app)
    return app, handlers, original, calls


@pytest.mark.parametrize('signum', [signal.SIGINT, signal.SIGTERM])
def test_main_signals_finish_owned_runtime_cleanup_once(fake_main, signum):
    app, handlers, original, calls = fake_main

    def serve():
        calls.append('serve')
        handlers[signum](signum, None)

    def shutdown():
        calls.append('runner shutdown')
        # A forwarded/group duplicate or a second stop request cannot interrupt
        # the runner while it closes its owned child processes.
        handlers[signal.SIGINT](signal.SIGINT, None)
        handlers[signal.SIGTERM](signal.SIGTERM, None)

    app.serve_forever = serve
    app.runner.shutdown = shutdown
    dashboard.main()
    assert calls == ['serve', 'runner shutdown', 'server close']
    assert handlers == original


def test_main_server_failure_still_cleans_up_and_propagates(fake_main):
    app, handlers, original, calls = fake_main

    def fail():
        raise RuntimeError('synthetic server failure')

    app.serve_forever = fail
    with pytest.raises(RuntimeError, match='synthetic server failure'):
        dashboard.main()
    assert calls == ['runner shutdown', 'server close']
    assert handlers == original


def test_signal_during_normal_cleanup_does_not_skip_server_close(fake_main):
    app, handlers, original, calls = fake_main

    def shutdown():
        calls.append('runner shutdown')
        handlers[signal.SIGTERM](signal.SIGTERM, None)

    app.runner.shutdown = shutdown
    dashboard.main()
    assert calls == ['serve', 'runner shutdown', 'server close']
    assert handlers == original


def test_main_runner_cleanup_failure_still_closes_server_and_restores_handlers(fake_main):
    app, handlers, original, calls = fake_main

    def fail():
        calls.append('runner shutdown')
        raise RuntimeError('synthetic cleanup failure')

    app.runner.shutdown = fail
    with pytest.raises(RuntimeError, match='synthetic cleanup failure'):
        dashboard.main()
    assert calls == ['serve', 'runner shutdown', 'server close']
    assert handlers == original


def test_node_launcher_preserves_child_failures_and_requested_shutdowns():
    node = shutil.which('node')
    if node is None:
        pytest.skip('Node.js is not available')
    # Evaluate the real launcher body with fake process/spawn objects. The build
    # import is removed so this test cannot write assets or start a Python app.
    harness = r'''
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants } from 'node:os';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
const source = readFileSync(process.argv[1], 'utf8')
  .replace(/^import .+;\r?\n/gm, '')
  .replace("await import('./build.mjs');", '')
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(process.argv[1]).href));
async function simulate({ requested, code = null, exitSignal = null, error = false }) {
  const child = new EventEmitter(), runtime = new EventEmitter(), forwarded = [], errors = [];
  runtime.argv = ['node', 'start.mjs']; runtime.env = {};
  child.kill = signal => { forwarded.push(signal); return true; };
  await vm.runInNewContext('(async () => {\n' + source + '\n})()', {
    spawn: () => child, existsSync: () => false, fileURLToPath, constants, URL,
    process: runtime, console: { error: text => errors.push(text) },
  });
  if (requested) runtime.emit(requested);
  if (error) child.emit('error', new Error('synthetic spawn failure'));
  child.emit('exit', code, exitSignal);
  return { code: runtime.exitCode, forwarded, errors };
}
const result = [];
for (const scenario of [
  { exitSignal: 'SIGKILL' }, { exitSignal: 'SIGTERM' }, { code: 7 }, { code: 0 },
  { requested: 'SIGTERM', exitSignal: 'SIGTERM' }, { requested: 'SIGINT', code: 0 },
  { requested: 'SIGINT', code: 9 }, { error: true, code: 0 },
]) result.push(await simulate(scenario));
console.log(JSON.stringify(result));
'''
    result = subprocess.run([node, '--input-type=module', '-e', harness, str(ROOT / 'scripts/start.mjs')],
                            text=True, capture_output=True, check=True, timeout=10)
    cases = json.loads(result.stdout)
    assert [case['code'] for case in cases] == [137, 143, 7, 0, 0, 0, 9, 1]
    assert cases[4]['forwarded'] == ['SIGTERM']
    assert cases[5]['forwarded'] == ['SIGINT']
    assert cases[7]['errors'] == ['synthetic spawn failure']
