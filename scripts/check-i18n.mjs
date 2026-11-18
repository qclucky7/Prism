import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const chinese = await readJson('shared/i18n/zh-CN.json');
const english = await readJson('shared/i18n/en.json');
const legacy = await readJson('shared/i18n/legacy.json');
const errors = [];
const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort().join(',');

for (const key of new Set([...Object.keys(chinese), ...Object.keys(english)])) {
  if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(key)) errors.push(`Invalid message identifier ${key}`);
  for (const [locale, values] of [['zh-CN', chinese], ['en', english]]) {
    if (typeof values[key] !== 'string' || !values[key].trim()) errors.push(`Missing ${locale} translation for ${key}`);
  }
  if (typeof chinese[key] === 'string' && typeof english[key] === 'string'
    && placeholders(chinese[key]) !== placeholders(english[key])) errors.push(`Placeholder mismatch for ${key}`);
}
for (const key of Object.values(legacy)) {
  if (!Object.hasOwn(chinese, key)) errors.push(`Unknown historical message identifier ${key}`);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(`${directory}/${entry.name}`) : `${directory}/${entry.name}`))).flat();
}
const files = (await Promise.all(['src', 'shared', 'browser', 'public', 'src-tauri/src'].map(sourceFiles))).flat();
const generated = new Set(['public/creep.js', 'public/fingerprintjs-lib.js', 'public/prism-i18n.js']);
// Product names, language autonyms and fixed fingerprint samples are data.
const fixedValues = new Set(['比特浏览器', '待标记厂商', '简体中文', '本机原生 Chrome 基线',
  'Prism / 浏览器指纹 Ω 😀', 'mmmmmmmmmmlliWWΩ汉字', '完成']);

for (const file of files) {
  if (file.includes('/tests/') || !/\.(?:tsx?|js|rs)$/.test(file) || generated.has(file) || file === 'shared/i18n/legacy.ts') continue;
  const text = await readFile(file, 'utf8');
  const check = (value, line) => {
    if (/^(?:messages|errors|fingerprint\.help|network\.help|findings|history|recheck)\./.test(value)
      && !Object.hasOwn(chinese, value)) errors.push(`${file}:${line} references unknown message ${value}`);
    if (/\p{Script=Han}/u.test(value) && !fixedValues.has(value)) errors.push(`${file}:${line} contains untranslated application text ${value}`);
  };
  if (file.endsWith('.rs')) {
    for (const match of text.matchAll(/"([^"\n]*)"/g)) check(match[1], text.slice(0, match.index).split('\n').length);
    continue;
  }
  const root = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  function visit(node) {
    const line = root.getLineAndCharacterOfPosition(node.getStart(root)).line + 1;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node.text, line);
    if (ts.isCallExpression(node) && ['t', 'message'].includes(node.expression.getText(root))
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !Object.hasOwn(chinese, node.arguments[0].text)) {
      errors.push(`${file}:${line} uses an untranslated literal instead of a message identifier`);
    }
    if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text)) check(node.text.trim(), line);
    ts.forEachChild(node, visit);
  }
  visit(root);
}

if (errors.length) throw new Error('Localization validation failed\n' + errors.join('\n'));
console.log(`Validated ${Object.keys(chinese).length} Chinese and English messages and application references.`);
