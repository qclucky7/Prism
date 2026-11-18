import identifiers from './legacy.json';
import { createTranslator, dictionaries, type Language, type Message, type MessageKey } from './index';

// Only historical stored snapshots and older API responses need text matching.
// New messages travel as identifiers and parameters.
const templates = Object.entries(identifiers).filter(([source]) => /\{\d+\}/.test(source)).map(([source, key]) => {
  const indices: number[] = [];
  const pattern = source.split(/(\{\d+\})/g).map(part => {
    if (/^\{\d+\}$/.test(part)) {
      indices.push(Number(part.slice(1, -1)));
      return '(.+?)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key: key as MessageKey, pattern: new RegExp(`^${pattern}$`), indices };
});

export function renderStoredMessage(locale: Language, value: Message): string {
  const translate = createTranslator(locale);
  if (typeof value !== 'string') return translate(value);
  if (Object.hasOwn(dictionaries[locale], value)) return translate(value);
  const key = identifiers[value as keyof typeof identifiers];
  if (key) return translate(key);
  if (!/\p{Script=Han}/u.test(value)) return value;
  for (const { key, pattern, indices } of templates) {
    const match = pattern.exec(value);
    if (!match) continue;
    const params: string[] = [];
    indices.forEach((index, position) => { params[index] = match[position + 1]; });
    return translate(key, ...params);
  }
  return translate(value);
}

export function renderSystemName(locale: Language, value: string): string {
  // User-assigned instance and vendor names must be preserved.
  return /^(?:待标记厂商|比特浏览器|本机 Chrome 基线（.*）|本机原生 Chrome 基线（无头）)$/.test(value)
    || systemNameKeys.has(value) ? renderStoredMessage(locale, value) : value;
}

const systemNameKeys = new Set(['待标记厂商', '比特浏览器', '本机 Chrome 基线（当前窗口）',
  '本机 Chrome 基线（临时窗口）', '本机原生 Chrome 基线（无头）'].map(source => identifiers[source as keyof typeof identifiers]));
