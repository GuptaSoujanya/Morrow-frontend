import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:os';
await import('./build.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
// Keep backend location and the explicit local workspace owner out of source control.
if(existsSync(root+'.env.local'))process.loadEnvFile(root+'.env.local');
const localPython = fileURLToPath(new URL('../../venv/bin/python', import.meta.url));
const python = process.env.DASHBOARD_PYTHON || (existsSync(localPython) ? localPython : 'python3');
const child = spawn(python, [root + 'server.py', ...process.argv.slice(2).filter(arg=>arg!=='--dev')], { cwd: root, stdio: 'inherit' });
let shutdownSignal, childFailed = false;
child.on('error', error => { childFailed = true; console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  process.exitCode = childFailed ? 1 : code ?? (signal === shutdownSignal && shutdownSignal
    ? 0 : constants.signals[signal] ? 128 + constants.signals[signal] : 1);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  shutdownSignal = signal;
  child.kill(signal);
});
