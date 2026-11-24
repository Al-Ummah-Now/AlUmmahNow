'use client';

import AppLink from '@/components/AppLink';
import { Icon } from '@/components/shell/icons';
import { linkClass } from '@/components/ui';
import { useLanguage } from '@/i18n/I18nProvider';

interface Props {
  requestId: string;
  testId: string;
  className?: string;
}

const href = (id: string) => `/approvals/${encodeURIComponent(id)}`;

/** Just after a change was sent for approval (wiki AUN-WORKFLOWS §10): nothing changed yet, and where it waits. */
export function SentForApproval({ requestId, testId, className = '' }: Props) {
  const { t } = useLanguage();
  return (
    <p role="status" className={`flex items-start gap-2 rounded-lg border border-border bg-chip-pending-bg px-3 py-2 text-sm text-fg ${className}`} data-testid={testId}>
      <Icon name="clock" className="mt-0.5 size-4 shrink-0" />
      <span>
        {t('workflows.sent')}{' '}
        <AppLink href={href(requestId)} className={`${linkClass} underline underline-offset-2`} data-testid={`${testId}-link`}>
          {t('workflows.viewRequest')}
        </AppLink>
      </span>
    </p>
  );
}

/** In place of a control whose change is waiting for approval. */
export function WaitingForApproval({ requestId, testId, className = '' }: Props) {
  const { t } = useLanguage();
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${className}`} data-testid={testId}>
      <span className="inline-flex items-center gap-1 rounded bg-chip-pending-bg px-2 py-0.5 font-medium text-chip-pending-fg">
        <Icon name="clock" className="size-4" />
        {t('workflows.status.pending')}
      </span>
      <AppLink href={href(requestId)} className={linkClass} data-testid={`${testId}-link`}>
        {t('workflows.viewRequest')}
      </AppLink>
    </p>
  );
}
