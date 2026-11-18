import chinese from './zh-CN.json';
import english from './en.json';

export type Language = 'zh-CN' | 'en';
export type MessageKey = keyof typeof chinese;
export type MessageValue = string | number | boolean | null | MessageDescriptor;
export type MessageDescriptor = { code: MessageKey; params: MessageValue[] };
export type Message = string | MessageDescriptor;

export const dictionaries = { 'zh-CN': chinese, en: english };

export function isMessage(value: unknown, depth = 0): value is MessageDescriptor {
  if (!value || typeof value !== 'object' || depth >= 4) return false;
  const candidate = value as Partial<MessageDescriptor>;
  return typeof candidate.code === 'string' && Object.hasOwn(chinese, candidate.code)
    && Array.isArray(candidate.params) && candidate.params.length <= 20
    && candidate.params.every(param => param === null || typeof param === 'boolean'
      || typeof param === 'number' && Number.isFinite(param)
      || typeof param === 'string' && param.length <= 2400 || isMessage(param, depth + 1));
}

export function message(code: MessageKey, ...params: MessageValue[]): MessageDescriptor {
  return { code, params };
}

export function createTranslator(locale: Language) {
  return (key: Message, ...values: unknown[]): string => {
    const code = typeof key === 'string' ? key : key.code;
    const params = typeof key === 'string' ? values : key.params;
    const template = Object.hasOwn(dictionaries[locale], code) ? dictionaries[locale][code as MessageKey] : code;
    return template.replace(/\{(\d+)\}/g, (_, index: string) => {
      const value = params[Number(index)];
      if (isMessage(value)) return createTranslator(locale)(value);
      return String(value ?? '');
    });
  };
}

/** Carries a language-independent application error through async operations. */
export class MessageError extends Error {
  readonly descriptor: MessageDescriptor;

  constructor(value: MessageKey | MessageDescriptor, ...params: MessageValue[]) {
    const descriptor = typeof value === 'string' ? message(value, ...params) : value;
    super(descriptor.code);
    this.name = 'MessageError';
    this.descriptor = descriptor;
  }
}

export function errorMessage(error: unknown): Message {
  if (error instanceof MessageError) return error.descriptor;
  if (isMessage(error)) return error;
  const value = error instanceof Error ? error.message : String(error ?? '');
  return Object.hasOwn(chinese, value) ? message(value as MessageKey) : value;
}
