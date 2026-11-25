'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CreatorTermsDialog } from '@/components/legal/CreatorTermsGate';
import { markCreatorTermsRequired, needsCreatorTerms, type CreatorAccessState } from '@/hooks/useCreatorAccess';
import { useLanguage } from '@/hooks/useLanguage';

export interface CreatorTermsPrompt<T> {
  /** The server refused this action (`terms_required`) and the Terms are not accepted since: say so, with `reviewLink`. */
  needed: boolean;
  /** The server refused `what`: opens the dialog, and accepting runs `onRetry(what)` once. */
  refused: (what: T, options?: { quiet?: boolean }) => void;
  /** Asks before sending when the account is known not to have accepted; true: asked, don't send. */
  askFirst: (creator: CreatorAccessState, what: T) => boolean;
  /** A new attempt, or another answer: the refusal no longer stands. */
  clear: () => void;
  /** Opens the dialog again. */
  review: () => void;
  /** "Review Terms", next to the message. */
  reviewLink: (testId: string) => ReactNode;
  dialog: ReactNode;
}

/**
 * The creator Terms dialog for a screen whose action the server may refuse with `terms_required`
 * (#1929). Accepting runs the refused action again, once, with what the screen holds now; refused
 * again right then (an older server during a rollout), it says so and does not ask in a loop.
 */
export function useCreatorTermsPrompt<T = void>(onRetry: (what: T) => unknown): CreatorTermsPrompt<T> {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [needed, setNeeded] = useState(false);
  const [accepted, setAccepted] = useState(0);
  const what = useRef<T | undefined>(undefined);
  const retrying = useRef(false);
  const latest = useRef(onRetry);
  latest.current = onRetry;

  // After the commit that carries the acceptance, so the retry sees it
  useEffect(() => {
    if (accepted === 0) return;
    retrying.current = true;
    void Promise.resolve(latest.current(what.current as T)).finally(() => {
      retrying.current = false;
    });
  }, [accepted]);

  const refused = useCallback((action: T, options?: { quiet?: boolean }) => {
    markCreatorTermsRequired();
    what.current = action;
    setNeeded(true);
    if (!options?.quiet && !retrying.current) setOpen(true);
  }, []);

  const askFirst = useCallback((creator: CreatorAccessState, action: T) => {
    if (retrying.current || !needsCreatorTerms(creator)) return false;
    what.current = action;
    setOpen(true);
    return true;
  }, []);

  const clear = useCallback(() => setNeeded(false), []);
  const review = useCallback(() => setOpen(true), []);

  return {
    needed,
    refused,
    askFirst,
    clear,
    review,
    reviewLink: (testId) =>
      needed ? (
        <button type="button" onClick={review} className="text-sm font-medium text-[var(--fanous-color-accent)] underline" data-testid={testId}>
          {t.upload.termsGateReviewAction}
        </button>
      ) : null,
    dialog: (
      <CreatorTermsDialog
        open={open}
        onOpenChange={setOpen}
        onAccepted={() => {
          setNeeded(false);
          setAccepted((n) => n + 1);
        }}
      />
    ),
  };
}
