/**
 * A failed change in the admin's words: admin-api's error code when the
 * dictionary has it (content.errors.<code>), else a status-based sentence.
 * Never the raw error text for a server failure.
 */
import type { MessageKey, Translator } from '@/i18n/translate';

export function describeActionError(t: Translator, error: unknown): string {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: unknown }).status) : 0;
  const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (status === 401) return t('errors.notAuthenticated');
  if (typeof code === 'string' && code) {
    const key = `content.errors.${code}` as MessageKey;
    const text = t(key);
    if (text !== key) return text;
  }
  if (status === 403) return t('content.errors.forbidden');
  if (status === 0) return t('list.networkError');
  return t('list.actionFailed');
}
