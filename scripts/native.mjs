import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const cargoManifest = path.join(projectDirectory, 'src-tauri', 'Cargo.toml');
export const nativeExecutable = path.join(projectDirectory, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'prism.exe' : 'prism');

export function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve()
      : reject(new Error(`${label} exited with ${signal ?? code}`)));
  });
}

export async function cargo(command) {
  const args = [command, '--manifest-path', cargoManifest];
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectDirectory, 'scripts', 'cargo.ps1'), ...args], { cwd: projectDirectory, stdio: 'inherit', windowsHide: true })
    : spawn('cargo', args, { cwd: projectDirectory, stdio: 'inherit' });
  await waitForExit(child, `cargo ${command}`);
}

export function startNative({ dataDirectory = process.env.PRISM_DATA_DIR ?? path.join(projectDirectory, 'data'), port = process.env.PORT ?? '0' } = {}) {
  return spawn(nativeExecutable, ['--serve'], {
    cwd: projectDirectory,
    env: { ...process.env, PRISM_DATA_DIR: path.resolve(dataDirectory), PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
}

export function backendOrigin(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => finish(new Error('The native backend did not report its address within 20 seconds')), 20000);
    const read = chunk => {
      output += chunk.toString();
      const address = output.match(/Prism API: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (address) finish(undefined, address);
    };
    const failed = error => finish(error);
    const exited = code => finish(new Error(`The native backend exited before startup (${code})`));
    function finish(error, address) {
      clearTimeout(timeout);
      child.stdout.off('data', read);
      child.off('error', failed);
      child.off('exit', exited);
      if (error) reject(error);
      else resolve(address);
    }
    child.stdout.on('data', read);
    child.once('error', failed);
    child.once('exit', exited);
  });
}

export async function stopNative(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end();
  const deadline = setTimeout(() => child.kill(), 20000);
  try { await exited; } finally { clearTimeout(deadline); }
}

async function main(command) {
  if (command === 'build' || command === 'test') return cargo(command);
  if (command === 'desktop') {
    const child = spawn(nativeExecutable, [], { cwd: projectDirectory, stdio: 'inherit', windowsHide: true });
    return waitForExit(child, 'Prism');
  }
  if (command !== 'serve') throw new Error(`Unknown native command ${command}`);
  const child = startNative({ port: process.env.PORT ?? '4318' });
  const exited = waitForExit(child, 'Prism');
  const shutdown = () => { void stopNative(child); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  try { await exited; }
  finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await stopNative(child);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
