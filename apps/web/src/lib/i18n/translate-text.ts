'use client';

/**
 * Extension point for "Translate" beside English/Arabic field pairs
 * (BilingualPair). No provider is registered yet: the inline-translation
 * track registers one with `registerTranslator`, and every pair (bulk edit,
 * upload "Set values", the video editor) then shows a Translate button
 * (English → Arabic, or Arabic → English). Until then nothing is shown.
 */
import { useSyncExternalStore } from 'react';
import type { TitleLanguage } from '@al-ummah/shared-types';

export type Translator = (text: string, from: TitleLanguage, to: TitleLanguage) => Promise<string>;

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
