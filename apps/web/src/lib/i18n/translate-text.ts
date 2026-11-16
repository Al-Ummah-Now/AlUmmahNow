'use client';

/**
 * "Translate" beside English/Arabic field pairs (BilingualPair; AUN-CAPTIONS §5.8). Signed-in
 * visitors get a translator backed by POST /api/translate (InlineTranslatorRegistrar) while the
 * feature is on for them (GET /api/me/features `inlineTranslate`); every pair
 * (bulk edit, upload "Set values", the video editor, playlists) then shows a Translate button
 * (English → Arabic, or Arabic → English). Signed out or switched off, nothing is shown.
 */
import { useSyncExternalStore } from 'react';
import type { InlineTranslateField, TitleLanguage } from '@al-ummah/shared-types';

/** What is being translated: the field kind, and the video it belongs to (its title is used as context). */
export interface TranslateContext {
  field?: InlineTranslateField;
  videoId?: string;
}

export type Translator = (text: string, from: TitleLanguage, to: TitleLanguage, context?: TranslateContext) => Promise<string>;

/** `feature_off`: the Translate button was switched off meanwhile; it disappears, with no message */
export type TranslateFailureCode = 'fair_use_limit' | 'feature_off' | 'budget_spent' | 'failed';

/** A refusal the pair explains to the creator (the daily limit with its reset time, budget spent). */
export class TranslateFailure extends Error {
  constructor(
    readonly code: TranslateFailureCode,
    readonly resetsAt?: string,
  ) {
    super(code);
    this.name = 'TranslateFailure';
  }
}

let current: Translator | null = null;
const listeners = new Set<() => void>();

/** Register (or clear, with null) the translator the pairs use. */
export function registerTranslator(translator: Translator | null): void {
  current = translator;
  listeners.forEach((l) => l());
}

/** The registered translator, or null (no Translate button). */
export function useTranslator(): Translator | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => null,
  );
}
