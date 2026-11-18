import type { MessageDescriptor } from './index.js';

export type ApiErrorPayload = MessageDescriptor & { message: string };

/** API errors arrive ready to display in the language requested by the caller. */
export function apiErrorText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object') return;
  const text = (value as { message?: unknown }).message;
  return typeof text === 'string' && text.trim() ? text : undefined;
}
