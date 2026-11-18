import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import './check-i18n.mjs';

const design = JSON.parse(await readFile(new URL('../shared/theme.json', import.meta.url), 'utf8'));
const themeCss = Object.entries(design.palettes).map(([mode, palette]) => {
  const selector = mode === 'light' ? ':root, :host' : ':root[data-theme="dark"], :host([data-theme="dark"])';
  const variables = { ...palette, font: design.font, mono: design.mono,
    radius: `${design.radius}px`, controlHeight: `${design.controlHeight}px` };
  const declarations = Object.entries(variables).map(([key, value]) =>
    `  --prism-${key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())}: ${value};`);
  return `${selector} {\n  color-scheme: ${mode};\n${declarations.join('\n')}\n}`;
});
await writeFile('public/prism-theme.css', '/* Generated from shared/theme.json. */\n' + themeCss.join('\n\n') + '\n');

await build({ entryPoints: ['shared/i18n/index.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: 'chrome110', outfile: 'public/prism-i18n.js' });

const upstream = JSON.parse(await readFile('vendor/creepjs/UPSTREAM.json', 'utf8'));
for (const [file, expected] of Object.entries(upstream.sha256)) {
  const content = await readFile('vendor/creepjs/' + file);
  if (createHash('sha256').update(content).digest('hex') !== expected) throw new Error('Upstream source changed: ' + file);
}
// Use upstream's Rollup + TypeScript pipeline. esbuild rejects an intentional
// constant-assignment exception probe in lies/index.ts; changing it changes the test.
const bundle = await rollup({ input: 'browser/upstream.ts', plugins: [json(), typescript({ tsconfig: false, noCheck: true, target: 'ES2020', module: 'ESNext', moduleResolution: 'node', alwaysStrict: true, include: ['browser/**/*.ts', 'vendor/creepjs/src/**/*.ts', 'shared/**/*.ts'] })], onwarn(warning, warn) { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); } });
await bundle.write({ file: 'public/creep.js', format: 'iife', banner: `/* Prism adapter using CreepJS source, MIT, Copyright (c) 2021 abrahamjuliot. Commit ${upstream.commit}. See /licenses/creepjs.txt. Not an official CreepJS deployment. */\nconst __UPSTREAM_COMMIT__ = ${JSON.stringify(upstream.commit)};` });
await bundle.close();
await writeFile('public/licenses/creepjs.txt', await readFile('vendor/creepjs/LICENSE'));
await build({ stdin: { contents: "export { default } from '@fingerprintjs/fingerprintjs'", resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome110', outfile: 'public/fingerprintjs-lib.js' });
await writeFile('public/licenses/fingerprintjs.txt', await readFile('node_modules/@fingerprintjs/fingerprintjs/LICENSE'));
// Serialize the page-side CDP programs for the in-process Rust server.
const { outputFiles: [manifestModule] } = await build({
  stdin: { contents: `
    import { browserLeaksPage } from './browser/browserLeaks.ts';
    import { dnsSiteExpression } from './browser/dnsSite.ts';
    import { browserLeaksCheckIds, captureToolIds, defaultCaptureTools, supplementalNetworkTools } from './shared/captureTools.ts';
    export default { browserLeaks: Object.fromEntries(browserLeaksCheckIds.map(check => [check, browserLeaksPage(check)])),
      captureToolIds, defaultCaptureTools, supplementalNetworkTools,
      dns: { progress: dnsSiteExpression(false), result: dnsSiteExpression(true) } };`, resolveDir: process.cwd() },
  write: false, bundle: true, format: 'esm', platform: 'node',
});
const { default: manifest } = await import('data:text/javascript;base64,' + Buffer.from(manifestModule.text).toString('base64'));
await mkdir('src-tauri/generated', { recursive: true });
await writeFile('src-tauri/generated/probes.json', JSON.stringify(manifest));
console.log('Built local CreepJS modules at ' + upstream.commit);
