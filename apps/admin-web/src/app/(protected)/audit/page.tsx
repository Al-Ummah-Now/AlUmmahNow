import { ADMIN_AUDIT_AREAS, ADMIN_AUDIT_ITEM_KINDS, type AdminAuditArea, type AdminAuditFeedPage, type AdminAuditItemKind, type AdminSuggestion } from '@al-ummah/shared-types';
import { getAuditActions, getAuditFeed } from '@/lib/api/audit';
import { getAdminSession } from '@/lib/auth';
import { canReadAudit } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { type MessageKey } from '@/i18n/translate';
import { ErrorAlert } from '@/components/ui';
import { CursorPager, EmptyState, tableWrapClass, tdClass, thClass } from '@/components/content/parts';
import { AuditWhat } from '@/components/audit/AuditEntryList';
import type { AuditTierNames } from '@/components/audit/audit-model';
import { listCreatorTierDefinitions } from '@/lib/api/creators';
import { PersonName } from '@/components/audit/Named';
import { auditHref, itemView, personView } from '@/components/audit/audit-model';
import { logger } from '@/lib/logger';
import { AuditFilters, type AuditFilterValues } from './AuditFilters';

import { LocalTime } from '@/components/LocalTime';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Audit log (issue #711): every admin action in the videos admin (content, deletions,
 * processing, uploads, delivery, live, scholar sites, themes, settings, account requests,
 * status page, staff devices), newest first, filtered by person, item, area, action and date.
 * People and items show by name (issue #745). audit:read (admins and super admins).
 */
export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadAudit(session?.user.role)) {
    return <ErrorAlert testId="audit-no-access">{t('auditLog.noAccess')}</ErrorAlert>;
  }

  const itemKind = (ADMIN_AUDIT_ITEM_KINDS as readonly string[]).includes(one(sp.itemKind) ?? '') ? (one(sp.itemKind) as AdminAuditItemKind) : undefined;
  const values: AuditFilterValues = {
    actorId: one(sp.actorId),
    itemKind,
    itemId: itemKind ? one(sp.itemId) : undefined,
    area: (ADMIN_AUDIT_AREAS as readonly string[]).includes(one(sp.area) ?? '') ? (one(sp.area) as AdminAuditArea) : undefined,
    action: one(sp.action),
    from: DATE.test(one(sp.from) ?? '') ? one(sp.from) : undefined,
    to: DATE.test(one(sp.to) ?? '') ? one(sp.to) : undefined,
  };
  const cursor = one(sp.cursor);

  let page: AdminAuditFeedPage | null = null;
  let actions: { action: string; area: AdminAuditArea }[] = [];
  const [feed, actionList, tierList] = await Promise.allSettled([getAuditFeed({ ...values, cursor }), getAuditActions(), listCreatorTierDefinitions()]);
  // Tier names for the Payments lines (prices and comps name their tier); a failed read shows the ids
  const tiers: AuditTierNames = tierList.status === 'fulfilled' ? Object.fromEntries(tierList.value.map((tier) => [tier.id, { name: tier.name, nameAr: tier.nameAr ?? null }])) : {};
  if (feed.status === 'fulfilled') page = feed.value;
  else logger.error('[audit] Failed to load the feed', { error: feed.reason instanceof Error ? feed.reason.message : String(feed.reason) });
  if (actionList.status === 'fulfilled') actions = actionList.value;

  const names = page?.names ?? null;
  // The chosen person and item as Autocomplete chips, from the names the page already has
  const actorItem: AdminSuggestion | null = values.actorId && names?.users[values.actorId]
    ? (() => {
        const p = personView(values.actorId!, names, t);
        return { kind: 'user', id: p.id, label: p.label, secondary: p.email, imageUrl: null };
      })()
    : null;
  const targetItem: AdminSuggestion | null = values.itemKind && values.itemId && (names?.items[`${values.itemKind}:${values.itemId}`] || (values.itemKind === 'user' && names?.users[values.itemId]))
    ? { kind: values.itemKind, id: values.itemId, label: itemView(values.itemKind, values.itemId, names, t).label, secondary: null, imageUrl: null }
    : null;
  const filtered = Object.values(values).some(Boolean);
  const filters = values as Record<string, string | undefined>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('auditLog.title')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('auditLog.subtitle')}</p>
      </div>

      <AuditFilters values={values} actions={actions} actorItem={actorItem} targetItem={targetItem} />

      {!page && <ErrorAlert testId="audit-error">{t('auditLog.loadFailed')}</ErrorAlert>}

      {page && page.items.length === 0 && (
        <div data-testid="audit-empty">
          <EmptyState>{filtered ? t('auditLog.empty') : t('auditLog.emptyAll')}</EmptyState>
        </div>
      )}

      {page && page.items.length > 0 && (
        <>
          {/* One table: rows at md and wider; below, each row is a card (what first, then who, area and when) */}
          <div className={`${tableWrapClass} max-md:overflow-visible`}>
            <table className="w-full text-sm max-md:block" data-testid="audit-table">
              <caption className="sr-only">{t('auditLog.tableCaption')}</caption>
              <thead className="border-b border-border max-md:hidden">
                <tr>
                  <th scope="col" className={thClass}>{t('auditLog.when')}</th>
                  <th scope="col" className={thClass}>{t('auditLog.who')}</th>
                  <th scope="col" className={thClass}>{t('auditLog.area')}</th>
                  <th scope="col" className={thClass}>{t('auditLog.what')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border max-md:block">
                {page.items.map((e) => (
                  <tr key={e.id} data-testid="audit-row" data-action={e.action} data-area={e.area} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-4">
                    <td className={`${tdClass} whitespace-nowrap text-fg-muted max-md:order-4 max-md:p-0 max-md:text-xs`}>
                      <LocalTime value={e.createdAt} withTime />
                    </td>
                    <td className={`${tdClass} md:min-w-[10rem] max-md:order-2 max-md:p-0`}>
                      <span className="md:hidden text-fg-subtle text-xs">{t('auditLog.by')} </span>
                      <PersonName person={personView(e.actorId, names, t, e.actorEmail)} testId="audit-actor" />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-fg-muted max-md:order-3 max-md:p-0 max-md:text-xs`}>{t(`auditLog.areas.${e.area}` as MessageKey)}</td>
                    <td className={`${tdClass} md:min-w-[16rem] max-md:order-1 max-md:p-0`}>
                      <AuditWhat entry={e} names={names} t={t} showTarget locale={locale} tiers={tiers} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CursorPager
            hasCursor={!!cursor}
            nextHref={page.next ? auditHref({ ...filters, cursor: page.next }) : null}
            firstHref={auditHref(filters)}
            labels={{ first: t('auditLog.first'), next: t('auditLog.next') }}
            t={t}
          />
        </>
      )}
    </div>
  );
}
