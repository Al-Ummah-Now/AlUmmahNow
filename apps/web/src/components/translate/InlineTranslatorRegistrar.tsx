'use client';

/**
 * Registers the Translate button's translator (lib/i18n/translate-text.ts) for signed-in visitors
 * while the Translate button is switched on for them (GET /api/me/features `inlineTranslate`),
 * backed by POST /api/translate. Signed out or off, no translator: the pairs show no Translate button.
 * A 404 feature_off (switched off meanwhile) reads the features again, which removes the button.
 */
import { useEffect } from 'react';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { registerTranslator, TranslateFailure, type Translator } from '@/lib/i18n/translate-text';
import { translateTexts } from '@/lib/api/translate-client';
import { reportError } from '@/lib/errors/reporter';
import { refreshFeatures, useFeatures } from '@/hooks/useFeatures';
import { FEATURE_OFF_CODE } from '@al-ummah/shared-types';

const KNOWN = new Set(['fair_use_limit', 'budget_spent']);

export const apiTranslator: Translator = async (text, from, to, context) => {
  const res = await translateTexts({ items: [{ id: 't', text }], from, to, ...(context?.field ? { field: context.field } : {}), ...(context?.videoId ? { videoId: context.videoId } : {}) });
  if (!res.ok) {
    if (res.status === 404 && res.error === FEATURE_OFF_CODE) {
      void refreshFeatures();
      throw new TranslateFailure('feature_off');
    }
    if (KNOWN.has(res.error)) throw new TranslateFailure(res.error as 'fair_use_limit', res.resetsAt);
    if (res.status >= 500 || res.status === 0) reportError(new Error(`inline translation failed: ${res.error}`), { shown: true, status: res.status, extra: { from, to, field: context?.field ?? null } });
    throw new TranslateFailure('failed');
  }
  const item = res.data.items[0];
  if (!item) throw new TranslateFailure('failed');
  return item.text;
};

/** Signed in only: a signed-out visitor never asks for the features (the registrar is on every page) */
function SignedInRegistrar() {
  const { features } = useFeatures();
  const on = features.inlineTranslate;
  useEffect(() => {
    if (!on) return;
    registerTranslator(apiTranslator);
    return () => registerTranslator(null);
  }, [on]);
  return null;
}

export function InlineTranslatorRegistrar() {
  const { user } = useOptionalAuth();
  return user ? <SignedInRegistrar /> : null;
}

export default InlineTranslatorRegistrar;
