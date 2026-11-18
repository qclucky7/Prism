import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { cargo, projectDirectory, waitForExit } from './native.mjs';

const files = (await readdir(new URL('../tests/', import.meta.url))).filter(file => file.endsWith('.test.ts')).map(file => `tests/${file}`);
const tests = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: projectDirectory, stdio: 'inherit', windowsHide: true,
});
await waitForExit(tests, 'Shared TypeScript tests');
await cargo('test');
