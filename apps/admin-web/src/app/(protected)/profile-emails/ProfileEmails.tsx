'use client';

/** Profile emails (super admins): start a check or a repair, read a run's report, check the CSAM cases. */
import { useState } from 'react';
import Link from '@/components/AppLink';
import type { CsamEmailCheckPage, CsamEmailMismatch, ProfileEmailsReportPage } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { linkClass, primaryButtonClass } from '@/components/ui';
import { checkCsamEmails, getProfileEmailsReport, startProfileEmails } from '@/lib/api/profile-emails';

const Email = ({ value }: { value: string | null }) => {
  const { t } = useLanguage();
  return value ? <bdi dir="ltr" className="[overflow-wrap:anywhere]">{value}</bdi> : <span className="text-fg-subtle">{t('profileEmails.none')}</span>;
};

const listClass = 'divide-y divide-border rounded-lg border border-border bg-surface';
/** One record: id, stored, account. Stacked on a phone, side by side from md. */
const rowClass = 'grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-4';

function RecordLink({ href, id }: { href: string; id: string }) {
  return (
    <Link href={href} className={linkClass}>
      <bdi dir="ltr" className="font-mono [overflow-wrap:anywhere]">{id}</bdi>
    </Link>
  );
}

function Labelled({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="min-w-0">
      <span className="block text-xs text-fg-muted">{label}</span>
      <Email value={value} />
    </p>
  );
}

export function ProfileEmailsStart({ running, check }: { running: boolean; check: { id: string; records: number } | null }) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  return (
    <div className="space-y-3">
      <ActionFeedback error={error} message={message} testId="profile-emails-feedback" />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={running || !!busy}
          onClick={() => void run('check', () => startProfileEmails('check'), { success: t('profileEmails.started') })}
          data-testid="profile-emails-check"
        >
          {running ? t('profileEmails.running') : t('profileEmails.startCheck')}
        </button>
        {check && (
          <ConfirmButton
            label={t('profileEmails.startRepair')}
            title={t('profileEmails.repairTitle')}
            body={t('profileEmails.repairBody', { count: check.records })}
            confirmLabel={t('profileEmails.startRepair')}
            danger
            disabled={running || !!busy}
            busy={busy === 'repair'}
            testId="profile-emails-repair"
            onConfirm={() => run('repair', () => startProfileEmails('repair', check.id), { success: t('profileEmails.started') })}
          />
        )}
      </div>
    </div>
  );
}

export function ProfileEmailsReport({ jobId, pages }: { jobId: string; pages: number[] }) {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  const [loaded, setLoaded] = useState<ProfileEmailsReportPage[]>([]);
  const next = pages[loaded.length];
  const entries = loaded.flatMap((p) => p.entries);
  const noAccount = loaded.flatMap((p) => p.noAccount);

  async function more() {
    const page = await run('report', () => getProfileEmailsReport(jobId, next), { refresh: false });
    if (page) setLoaded((list) => [...list, page]);
  }

  return (
    <div className="space-y-3">
      <ActionFeedback error={error} message={null} testId="profile-emails-report-feedback" />
      {entries.length > 0 && (
        <ul className={listClass} aria-label={t('profileEmails.entriesCaption')} data-testid="profile-emails-entries">
          {entries.map((e) => (
            <li key={`${e.kind}-${e.id}`} className={rowClass} data-record={`${e.kind}:${e.id}`}>
              <p className="min-w-0">
                <span className="block text-xs text-fg-muted">{t(e.kind === 'profile' ? 'profileEmails.profile' : 'profileEmails.channel')}</span>
                <RecordLink href={`/${e.kind === 'profile' ? 'users' : 'channels'}/${encodeURIComponent(e.id)}`} id={e.id} />
                {e.outcome && <span className="block text-xs text-fg-muted">{t(`profileEmails.outcomes.${e.outcome}` as MessageKey)}</span>}
              </p>
              <Labelled label={t('profileEmails.colStored')} value={e.stored} />
              <Labelled label={t('profileEmails.colAccount')} value={e.account} />
            </li>
          ))}
        </ul>
      )}
      {noAccount.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-fg">{t('profileEmails.noAccountList')}</summary>
          <ul className="mt-2 space-y-1 text-sm" data-testid="profile-emails-no-account">
            {noAccount.map((n) => (
              <li key={n.userId} className="flex flex-wrap gap-x-3">
                <RecordLink href={`/users/${encodeURIComponent(n.userId)}`} id={n.userId} />
                <Email value={n.stored} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {next !== undefined && (
        <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => void more()} data-testid="profile-emails-report-more">
          {busy ? t('content.working') : t(loaded.length ? 'profileEmails.moreReport' : 'profileEmails.showReport')}
        </button>
      )}
    </div>
  );
}

export function CsamEmailCheck() {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  const [state, setState] = useState<{ checked: number; items: CsamEmailMismatch[]; done: boolean } | null>(null);

  async function check() {
    let after: string | null = null;
    let checked = 0;
    const items: CsamEmailMismatch[] = [];
    do {
      const page: CsamEmailCheckPage | null = await run('csam', () => checkCsamEmails(after), { refresh: false });
      if (!page) return;
      checked += page.checked;
      items.push(...page.items);
      after = page.next;
      setState({ checked, items: [...items], done: !after });
    } while (after);
  }

  return (
    <div className="space-y-3">
      <ActionFeedback error={error} message={null} testId="csam-email-feedback" />
      <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => void check()} data-testid="csam-email-check">
        {busy ? t('content.working') : t('profileEmails.csamCheck')}
      </button>
      <div aria-live="polite">
        {state && <p className="text-sm text-fg" data-testid="csam-email-summary">{t('profileEmails.csamSummary', { checked: state.checked, count: state.items.length })}</p>}
      </div>
      {state && state.items.length > 0 && (
        <ul className={listClass} aria-label={t('profileEmails.csamTitle')} data-testid="csam-email-items">
          {state.items.map((i) => (
            <li key={i.caseId} className={rowClass}>
              <p className="min-w-0">
                <span className="block text-xs text-fg-muted">{t('profileEmails.colCase')}</span>
                <RecordLink href={`/moderation/csam/${encodeURIComponent(i.caseId)}`} id={i.caseId} />
              </p>
              <Labelled label={t('profileEmails.colCaptured')} value={i.captured} />
              <Labelled label={t('profileEmails.colAccount')} value={i.account} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
