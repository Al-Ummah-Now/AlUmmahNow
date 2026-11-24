'use client';

/**
 * The id of a user nothing is known about (no videos profile, no stored email): kept out of
 * the line ("Unknown user" reads there) and one click away in a small disclosure, selectable
 * and copyable. Phrasing content only: names are shown inside paragraphs, and a block there (it was a
 * <details>) makes the browser close the paragraph, so hydration fails and the whole page renders again,
 * without its dark mode (2026-11-24).
 */
import { useId, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';

export function CopyId({ id, testId = 'unknown-user-id' }: { id: string; testId?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <span className="inline-block align-baseline text-xs" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline cursor-pointer text-fg-muted underline decoration-dotted underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        data-testid={`${testId}-toggle`}
      >
        {t('auditLog.userIdToggle')}
      </button>
      <span id={panelId} hidden={!open} className={open ? 'ms-1 inline-flex flex-wrap items-baseline gap-1' : undefined}>
        <code className="font-mono text-fg-subtle select-all break-all" dir="ltr" data-testid={`${testId}-value`}>
          {id}
        </code>
        <button
          type="button"
          className="text-link hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={t('auditLog.copyUserId')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(id);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch (error) {
              logger.warn('[audit] Could not copy the user id', { error: error instanceof Error ? error.message : String(error) });
            }
          }}
          data-testid={`${testId}-copy`}
        >
          {copied ? t('auditLog.idCopied') : t('auditLog.copy')}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? t('auditLog.idCopied') : ''}
        </span>
      </span>
    </span>
  );
}
