import Link from '@/components/AppLink';
import { CREATOR_TIER_IDS, DEFAULT_TIER_ID, type AdminAuditEntry, type CreatorTiersList  } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatDate, formatNumber, type MessageKey, type Translator } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { TierEditor, type TierActions } from './TierEditor';
import { TierRankList } from './TierRankList';
import { defaultTierName } from '@/lib/creator-tiers';
import { LimitHitsNotice } from './LimitHitsNotice';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { tierLabel } from '@/lib/creator-tiers';

const FIELD_LABEL: Record<string, MessageKey> = {
  name: 'creators.tierName',
  unlimited: 'creators.tierUnlimited',
  perHour: 'creators.tierPerHour',
  perDay: 'creators.tierPerDay',
  maxConcurrent: 'creators.tierConcurrent',
  maxChannels: 'creators.tierChannels',
  captionMinutesMonth: 'creators.tierCaptions',
  nameAr: 'creators.tierNameAr',
  description: 'creators.tierDescription',
  descriptionAr: 'creators.tierDescriptionAr',
  uploads: 'creators.tierUploadsFlag',
  channels: 'creators.tierChannelsFlag',
  requestable: 'creators.tierRequestable',
  sortOrder: 'creators.tierSortOrder',
};

/** What a tier audit row changed, in words (never raw JSON). */
function auditSummary(entry: AdminAuditEntry, t: Translator, list: CreatorTiersList | null, locale: Locale): string {
  if (entry.action === 'reorder') return t('creators.auditReorder');
  if (entry.action === 'set-default') return t('creators.auditSetDefault', { tier: defaultTierName(String(entry.details?.tierId ?? ''), list?.items ?? [], t, locale) });
  const previous = (entry as AdminAuditEntry & { previous?: Record<string, unknown> | null }).previous ?? null;
  // An edit sends the whole form: name only the fields whose value changed
  const fields = Object.keys(entry.details ?? {}).filter((k) => k !== 'id' && (!previous || previous[k] !== entry.details?.[k]));
  if (entry.action === 'create') return t('creators.auditCreate');
  if (entry.action === 'delete') return t('creators.auditDelete');
  return t('creators.auditEdit', { fields: fields.filter((f) => FIELD_LABEL[f]).map((f) => t(FIELD_LABEL[f])).join(', ') || '—' });
}

/** Users per tier (stored rows); accounts not backfilled yet work as Free, so Free counts them too. */
export function memberCounts(list: CreatorTiersList): Record<string, number> {
  return { ...list.counts.byTier, [DEFAULT_TIER_ID]: (list.counts.byTier[DEFAULT_TIER_ID] ?? 0) + list.counts.none };
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('creators.tiersTitle')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('creators.tiersSubtitle')}</p>
        <p className="text-fg-muted mt-1 text-sm">{t('creators.superAdminNote')}</p>
      </div>
      {list && <LimitHitsNotice count={list.limitHits7d} t={t} locale={locale} showWho />}
      {list && (
        <section className={`${cardClass} mb-6`} aria-labelledby="tiers-default-title" data-testid="tiers-default" data-default-tier={list.defaultTierId}>
          <h2 id="tiers-default-title" className="text-lg font-semibold text-fg mb-1">{t('creators.tiersDefaultTitle')}</h2>
          <p className="text-sm text-fg" data-testid="tiers-default-current">{t('creators.tiersDefaultCurrent', { tier: defaultTierName(list.defaultTierId, list.items, t, locale) })}</p>
          <p className="mt-1 text-sm text-fg-muted max-w-3xl">{t('creators.tiersDefaultBody')}</p>
          {list.counts.none > 0 && (
            <p className="mt-2 text-sm text-fg-muted" data-testid="tiers-none-count">
              {t('creators.tiersNone', { count: formatNumber(list.counts.none, locale), tier: (() => { const free = list.items.find((x) => x.id === CREATOR_TIER_IDS.member); return free ? tierLabel(free, locale) : t('creators.none'); })() })}{' '}
              <Link href="/users?tier=none" className={`${linkClass} underline`}>{t('creators.noticeNeedsTierLink')}</Link>
            </p>
          )}
        </section>
      )}
      {list && <TierRankList tiers={list.items} defaultTierId={list.defaultTierId} canManage={canManage} reorder={actions.reorder} />}
      {!canManage && <p className="mb-4 text-sm text-fg-muted">{t('creators.noAccess')}</p>}
      {list ? <TierEditor tiers={list.items} counts={memberCounts(list)} invites={list.pendingInvites} defaultTierId={list.defaultTierId} canManage={canManage} actions={actions} /> : <ErrorAlert testId="tiers-load-failed">{t('creators.loadFailed')}</ErrorAlert>}
      <section className={`${cardClass} mt-8`} aria-labelledby="tiers-audit" data-testid="tiers-audit">
        <h2 id="tiers-audit" className="text-lg font-semibold text-fg mb-3">{t('creators.tiersAudit')}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('creators.tiersAuditEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium text-fg">
                  {entry.key === 'content:creator-tier:default'
                    ? t('creators.auditDefaultName')
                    : entry.key === 'content:creator-tier:order'
                    ? t('creators.rankTitle')
                    : (() => { const tier = list?.items.find((x) => `content:creator-tier:${x.id}` === entry.key); return tier ? tierLabel(tier, locale) : null; })() ?? entry.key.replace('content:creator-tier:', '')}
                </span>{' '}
                <span className="text-fg">{auditSummary(entry, t, list, locale)}</span>{' '}
                <span className="text-fg-muted">{fillNodes(t('creators.historyBy', { date: formatDate(entry.createdAt, locale, true) }), { actor: <UserName id={entry.actorId} showEmail={false} /> })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
