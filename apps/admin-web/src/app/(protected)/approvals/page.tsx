import Link from '@/components/AppLink';
import { PriorityTabs } from '@/components/PriorityTabs';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { ErrorAlert, cardClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { RequestSearch } from '@/components/workflows/RequestSearch';
import { getI18n } from '@/i18n/server';
import { formatNumber, translateDynamic, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { getNames } from '@/lib/api/audit';
import { listWorkflowRequests, type WorkflowListItem } from '@/lib/api/workflows';
import { logger } from '@/lib/logger';
import { WORKFLOW_STATUS_CHIP, WORKFLOW_STATUS_RAIL, WORKFLOW_VIEWS, parseWorkflowView, statusLabel, workflowsHref } from '@/lib/workflows';

export const dynamic = 'force-dynamic';

const ROW_CARD = cardClass.replace('p-6', 'p-4 sm:p-5');

/**
 * Approvals (wiki AUN-WORKFLOWS §10): change requests waiting for the signed-in admin, their own,
 * every open one and the history. Each row says what changes, who asked, how many approvals it has
 * and until when it waits; the request page has the diff and the Approve and Reject buttons.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ view?: string; cursor?: string }> }) {
  const { t, locale } = await getI18n();
  const { view: rawView, cursor } = await searchParams;
  const view = parseWorkflowView(rawView);
  let page: { items: WorkflowListItem[]; next: string | null } | null = null;
  try {
    page = await listWorkflowRequests({ view, cursor });
  } catch (error) {
    logger.error('[approvals] Failed to load', { view, error: error instanceof Error ? error.message : String(error) });
  }
  const names = page?.items.length ? await getNames({ users: [...new Set(page.items.map((i) => i.proposedBy))] }) : null;
  const nameOf = (id: string) => names?.users[id]?.name ?? (names?.users[id]?.found === false ? t('workflows.deletedAccount') : t('workflows.someone'));

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('workflows.title')}</h1>
          <p className="text-fg-muted mt-2 max-w-prose">{t('workflows.subtitle')}</p>
        </div>
        <Link href="/approvals/rules" className={`${secondaryButtonClass} shrink-0 self-start`} data-testid="approvals-rules-link">
          {t('workflows.rulesLink')}
        </Link>
      </div>

      <div className="mb-4 max-w-xl">
        <RequestSearch />
      </div>

      <PriorityTabs
        label={t('workflows.tabsLabel')}
        testId="approvals-tabs"
        className="mb-6 border-b border-border"
        rowClassName="gap-1"
        tabClassName="block whitespace-nowrap px-3 py-2 -mb-px border-b-2"
        currentClassName="border-accent text-fg font-medium"
        idleClassName="border-transparent text-fg-muted hover:text-fg"
        tabTestIdPrefix="approvals-tab-"
        tabs={WORKFLOW_VIEWS.map((v) => ({ id: v, label: t(`workflows.tabs.${v}`), href: workflowsHref(v), current: v === view }))}
      />

      {!page && <ErrorAlert testId="approvals-error">{t('workflows.loadFailed')}</ErrorAlert>}
      {page && page.items.length === 0 && <p className="text-fg-muted" data-testid="approvals-empty">{t(`workflows.empty.${view}`)}</p>}
      {page && page.items.length > 0 && (
        <ul className="space-y-4" data-testid="approvals-list">
          {page.items.map((item) => (
            <RequestRow key={item.id} item={item} t={t} locale={locale} who={nameOf(item.proposedBy)} />
          ))}
        </ul>
      )}
      {page?.next && (
        <p className="mt-6">
          <Link href={workflowsHref(view, page.next)} className={secondaryButtonClass} data-testid="approvals-more">
            {t('workflows.more')}
          </Link>
        </p>
      )}
    </div>
  );
}

function RequestRow({ item, t, locale, who }: { item: WorkflowListItem; t: Translator; locale: Locale; who: string }) {
  const title = locale === 'ar' ? item.title.ar : item.title.en;
  const headingId = `approval-${item.id}`;
  return (
    <li className={`${ROW_CARD} border-s-4 ${WORKFLOW_STATUS_RAIL[item.status]}`} aria-labelledby={headingId} data-testid="approval-row" data-request-id={item.id} data-status={item.status}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{translateDynamic(t, 'workflows.domain', item.domain)}</p>
          <h2 id={headingId} className="mt-1 text-base font-semibold text-fg">
            <Link href={`/approvals/${encodeURIComponent(item.id)}`} className={linkClass} dir="auto" data-testid="approval-title">
              {title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            <span dir="auto">{t('workflows.proposedBy', { name: who })}</span>
            {t('common.sep')}
            <LocalTime value={item.proposedAt} withTime />
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-sm text-fg-muted sm:items-end">
          <span className={`self-start sm:self-end rounded px-2 py-0.5 font-medium ${WORKFLOW_STATUS_CHIP[item.status]}`} data-testid="approval-status">
            {statusLabel(t, item.status)}
          </span>
          {item.approvalsNeeded > 0 && (
            <span data-testid="approval-count">{t('workflows.approvals', { count: formatNumber(item.approvalsCount, locale), needed: formatNumber(item.approvalsNeeded, locale) })}</span>
          )}
          {item.status === 'pending' && <span>{fillNodes(t('workflows.expires'), { date: <LocalTime value={item.expiresAt} withTime /> })}</span>}
        </div>
      </div>
    </li>
  );
}
