'use client';

/**
 * The id of a user nothing is known about (no videos profile, no stored email): kept out of
 * the line ("Unknown user" reads there) and one click away in a small disclosure, selectable
 * and copyable. Native <details>, so it opens without JavaScript and with the keyboard.
 */
import { useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';

export function CopyId({ id, testId = 'unknown-user-id' }: { id: string; testId?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <details className="inline-block align-baseline text-xs" data-testid={testId}>
      <summary className="inline cursor-pointer text-fg-muted underline decoration-dotted underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        {t('auditLog.userIdToggle')}
      </summary>
      <span className="ms-1 inline-flex flex-wrap items-baseline gap-1">
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
    </details>
  );
}
