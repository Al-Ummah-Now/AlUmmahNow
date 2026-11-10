'use client';

/**
 * Ask for an AI category suggestion for the form's text (debounced) and poll
 * while the queued job runs. Never blocks the form: any failure just means no
 * suggestion, and polling stops after a minute.
 */
import { useEffect, useRef, useState } from 'react';
import { getCategorySuggestion, requestCategorySuggestion } from '@/lib/api/category-suggestion-client';
import type { CategoryFormText, CategorySuggestionView } from '@/lib/category-suggestion/form';
import { logger } from '@/lib/logger-client';

export const SUGGEST_DEBOUNCE_MS = 1200;
export const SUGGEST_POLL_MS = 2500;
export const SUGGEST_MAX_POLLS = 24;

export function useCategorySuggestion(options: { draftKey: string; text: CategoryFormText | null; enabled: boolean; channelId?: string }) {
  const { draftKey, text, enabled, channelId } = options;
  const [suggestion, setSuggestion] = useState<CategorySuggestionView | null>(null);
  const [loading, setLoading] = useState(false);
  const textKey = text ? JSON.stringify(text) : '';
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || !textKey) {
      setLoading(false);
      return;
    }
    const run = ++latest.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => run === latest.current;

    const poll = async (count: number) => {
      if (!current()) return;
      if (count >= SUGGEST_MAX_POLLS) {
        setLoading(false);
        return;
      }
      try {
        const next = await getCategorySuggestion({ draftKey });
        if (!current()) return;
        if (next && next.status !== 'pending') {
          setSuggestion(next);
          setLoading(false);
          return;
        }
      } catch (error) {
        logger.warn('[CategorySuggestion] Poll failed', { error: error instanceof Error ? error.message : String(error) });
      }
      timer = setTimeout(() => void poll(count + 1), SUGGEST_POLL_MS);
    };

    timer = setTimeout(async () => {
      if (!current()) return;
      setLoading(true);
      try {
        const first = await requestCategorySuggestion(draftKey, JSON.parse(textKey) as CategoryFormText, channelId);
        if (!current()) return;
        if (!first) {
          setLoading(false);
          return;
        }
        if (first.status === 'pending') {
          timer = setTimeout(() => void poll(0), SUGGEST_POLL_MS);
          return;
        }
        setSuggestion(first);
        setLoading(false);
      } catch (error) {
        logger.warn('[CategorySuggestion] Request failed', { error: error instanceof Error ? error.message : String(error) });
        if (current()) setLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [draftKey, textKey, enabled, channelId]);

  return { suggestion, loading };
}
