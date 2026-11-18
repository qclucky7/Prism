import { createTranslator, type Language, type Message } from '../shared/i18n';
import { renderStoredMessage, renderSystemName } from '../shared/i18n/legacy';

export type { Language } from '../shared/i18n';
let current: Language = 'zh-CN';
let translate = createTranslator(current);

export function setLanguage(value: Language) {
  current = value;
  translate = createTranslator(value);
}
export function language() { return current; }
export function t(key: Message, ...values: unknown[]) { return translate(key, ...values); }
export function renderMessage(value: Message) { return renderStoredMessage(current, value); }
export function knownName(value: string) { return renderSystemName(current, value); }
