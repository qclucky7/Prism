import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const commit = execFileSync('git', ['-C', 'vendor/creepjs', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sha256 = {};
async function visit(directory) {
  for (const entry of await readdir('vendor/creepjs/' + directory, { withFileTypes: true })) {
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) await visit(file);
    else sha256[file] = createHash('sha256').update(await readFile('vendor/creepjs/' + file)).digest('hex');
  }
}
await visit('src');
for (const file of ['LICENSE', 'TRADEMARKS.md']) sha256[file] = createHash('sha256').update(await readFile('vendor/creepjs/' + file)).digest('hex');
await writeFile('vendor/creepjs/UPSTREAM.json', JSON.stringify({ repository: 'https://github.com/abrahamjuliot/creepjs', commit, license: 'MIT', sha256 }, null, 2) + '\n');
await mkdir('public/licenses', { recursive: true });
