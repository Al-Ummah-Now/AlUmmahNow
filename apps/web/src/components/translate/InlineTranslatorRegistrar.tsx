'use client';

/**
 * Registers the Translate button's translator (lib/i18n/translate-text.ts) for signed-in visitors,
 * backed by POST /api/translate. Signed out, no translator: the pairs show no Translate button.
 */
import { useEffect } from 'react';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { registerTranslator, TranslateFailure, type Translator } from '@/lib/i18n/translate-text';
import { translateTexts } from '@/lib/api/translate';
import { reportError } from '@/lib/errors/reporter';

const KNOWN = new Set(['fair_use_limit', 'translation_paused', 'budget_spent']);

export const apiTranslator: Translator = async (text, from, to, context) => {
  const res = await translateTexts({ items: [{ id: 't', text }], from, to, ...(context?.field ? { field: context.field } : {}), ...(context?.videoId ? { videoId: context.videoId } : {}) });
  if (!res.ok) {
    if (KNOWN.has(res.error)) throw new TranslateFailure(res.error as 'fair_use_limit', res.resetsAt);
    if (res.status >= 500 || res.status === 0) reportError(new Error(`inline translation failed: ${res.error}`), { shown: true, status: res.status, extra: { from, to, field: context?.field ?? null } });
    throw new TranslateFailure('failed');
  }
  const item = res.data.items[0];
  if (!item) throw new TranslateFailure('failed');
  return item.text;
};

export function InlineTranslatorRegistrar() {
  const { user } = useOptionalAuth();
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    registerTranslator(apiTranslator);
    return () => registerTranslator(null);
  }, [signedIn]);
  return null;
}

export default InlineTranslatorRegistrar;
