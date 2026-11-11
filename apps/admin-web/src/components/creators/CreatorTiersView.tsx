import Link from '@/components/AppLink';
import type { AdminAuditEntry, CreatorTiersList } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatDate, formatNumber, type MessageKey, type Translator } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { BackLink } from '@/components/content/parts';
import { TierEditor, type TierActions } from './TierEditor';
import { LimitHitsNotice } from './LimitHitsNotice';

const FIELD_LABEL: Record<string, MessageKey> = {
  name: 'creators.tierName',
  unlimited: 'creators.tierUnlimited',
  perHour: 'creators.tierPerHour',
  perDay: 'creators.tierPerDay',
  maxConcurrent: 'creators.tierConcurrent',
  maxChannels: 'creators.tierChannels',
};

/** What a tier audit row changed, in words (never raw JSON). */
function auditSummary(entry: AdminAuditEntry, t: Translator): string {
  const previous = (entry as AdminAuditEntry & { previous?: Record<string, unknown> | null }).previous ?? null;
  // An edit sends the whole form: name only the fields whose value changed
  const fields = Object.keys(entry.details ?? {}).filter((k) => k !== 'id' && (!previous || previous[k] !== entry.details?.[k]));
  if (entry.action === 'create') return t('creators.auditCreate');
  if (entry.action === 'delete') return t('creators.auditDelete');
  return t('creators.auditEdit', { fields: fields.filter((f) => FIELD_LABEL[f]).map((f) => t(FIELD_LABEL[f])).join(', ') || '—' });
}

export interface CreatorTiersViewProps {
  /** null: the tiers could not be loaded */
  list: CreatorTiersList | null;
  audit: AdminAuditEntry[];
  canManage: boolean;
  t: Translator;
  locale: Locale;
  actions: TierActions;
}

/** The tier limits page body: the limit-hit notice, each tier's editor with its users, and recent changes. */
export function CreatorTiersView({ list, audit, canManage, t, locale, actions }: CreatorTiersViewProps) {
  return (
    <div>
      <BackLink href="/creators" label={t('content.back', { section: t('creators.title') })} />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('creators.tiersTitle')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('creators.tiersSubtitle')}</p>
        <p className="text-fg-muted mt-1 text-sm">{t('creators.superAdminNote')}</p>
      </div>
      {list && <LimitHitsNotice count={list.limitHits7d} t={t} locale={locale} showWho />}
      {list && (
        <p className="mb-4 text-sm text-fg-muted" data-testid="tiers-none-count">
          {t('creators.tiersNone', { count: formatNumber(list.counts.none, locale) })}{' '}
          <Link href="/creators?tier=none" className={`${linkClass} underline`}>{t('creators.noticeNeedsTierLink')}</Link>
        </p>
      )}
      {!canManage && <p className="mb-4 text-sm text-fg-muted">{t('creators.noAccess')}</p>}
      {list ? <TierEditor tiers={list.items} counts={list.counts.byTier} canManage={canManage} actions={actions} /> : <ErrorAlert testId="tiers-load-failed">{t('creators.loadFailed')}</ErrorAlert>}
      <section className={`${cardClass} mt-8`} aria-labelledby="tiers-audit" data-testid="tiers-audit">
        <h2 id="tiers-audit" className="text-lg font-semibold text-fg mb-3">{t('creators.tiersAudit')}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('creators.tiersAuditEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium text-fg">{list?.items.find((tier) => `content:creator-tier:${tier.id}` === entry.key)?.name ?? entry.key.replace('content:creator-tier:', '')}</span>{' '}
                <span className="text-fg">{auditSummary(entry, t)}</span>{' '}
                <span className="text-fg-muted">{t('creators.historyBy', { actor: entry.actorId, date: formatDate(entry.createdAt, locale, true) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
