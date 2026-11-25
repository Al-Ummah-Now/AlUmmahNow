import { ADMIN_NAMES_MAX, WORKFLOW_ACTIONS, workflowFieldPeople, workflowFieldShown, type WorkflowField, type WorkflowRequestView } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { RequestActions } from '@/components/workflows/RequestActions';
import { getI18n } from '@/i18n/server';
import { formatNumber, translateDynamic, type MessageKey } from '@/i18n/translate';
import { getNames } from '@/lib/api/audit';
import { approveWorkflowRequest, commentOnWorkflowRequest, getWorkflowRequest, rejectWorkflowRequest, retryWorkflowRequest, withdrawWorkflowRequest } from '@/lib/api/workflows';
import { logger } from '@/lib/logger';
import { WORKFLOW_STATUS_CHIP, fieldChanges, statusLabel, workflowPeople, workflowValue } from '@/lib/workflows';

export const dynamic = 'force-dynamic';

/**
 * One change request (wiki AUN-WORKFLOWS §10): what changes (before and after), why, who did what and
 * when, and the Approve, Reject, Withdraw, Retry and Comment actions the signed-in admin may take.
 * When they may not approve, the page says why.
 */
export default async function ApprovalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  const showAll = (await searchParams).all === '1';
  let request: WorkflowRequestView | null = null;
  try {
    request = await getWorkflowRequest(id);
  } catch (error) {
    logger.warn('[approvals] Request failed to load', { id, error: error instanceof Error ? error.message : String(error) });
  }
  if (!request) {
    return (
      <div>
        <BackLink label={t('workflows.back')} />
        <ErrorAlert testId="approval-error">{t('workflows.detailLoadFailed')}</ErrorAlert>
      </div>
    );
  }

  const people = [...new Set([request.proposedBy, ...request.steps.map((s) => s.actor), ...workflowFieldPeople(request.fields)])].filter((id) => id !== 'system');
  // A bulk change names up to 100 people on top of the ones in the history: one lookup per 100
  const lookups = await Promise.all(Array.from({ length: Math.ceil(people.length / ADMIN_NAMES_MAX) }, (_, i) => getNames({ users: people.slice(i * ADMIN_NAMES_MAX, (i + 1) * ADMIN_NAMES_MAX) })));
  const names: Record<string, string> = {};
  for (const [uid, u] of lookups.flatMap((l) => Object.entries(l.users))) names[uid] = u.name ?? (u.found ? t('workflows.someone') : t('workflows.deletedAccount'));
  const nameOf = (uid: string) => (uid === 'system' ? t('workflows.system') : (names[uid] ?? t('workflows.someone')));

  const title = locale === 'ar' ? request.title.ar : request.title.en;
  const changed = request.fields.filter(workflowFieldShown);
  const fields = showAll ? request.fields : changed;
  const can = request.can ?? { approve: false, reject: false, withdraw: false, blocks: [] };
  const domainKey = request.domain;

  return (
    // The header breadcrumb (Site › Approvals) leads back; a link above the title would sit under its halo
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{translateDynamic(t, 'workflows.domain', domainKey)}</p>
          <h1 className="mt-1 text-2xl font-bold text-fg sm:text-3xl" dir="auto" data-testid="approval-heading">
            {title}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            <span dir="auto">{t('workflows.proposedBy', { name: nameOf(request.proposedBy) })}</span>
            {t('common.sep')}
            <LocalTime value={request.proposedAt} withTime />
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-sm text-fg-muted sm:items-end">
          <span className={`self-start sm:self-end rounded px-2 py-0.5 font-medium ${WORKFLOW_STATUS_CHIP[request.status]}`} data-testid="approval-status">
            {statusLabel(t, request.status)}
          </span>
          {request.approvalsNeeded > 0 && (
            <span data-testid="approval-count">{t('workflows.approvals', { count: formatNumber(request.approvalsCount, locale), needed: formatNumber(request.approvalsNeeded, locale) })}</span>
          )}
          {request.status === 'pending' && <span>{fillNodes(t('workflows.expires'), { date: <LocalTime value={request.expiresAt} withTime /> })}</span>}
        </div>
      </div>

      <section className={`${cardClass} mb-4`} aria-labelledby="approval-reason">
        <h2 id="approval-reason" className="text-sm font-semibold text-fg-muted">{t('workflows.reason')}</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-fg" dir="auto" data-testid="approval-reason">
          {request.reason}
        </p>
      </section>

      <section className={`${cardClass} mb-4`} aria-labelledby="approval-changes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="approval-changes" className="text-lg font-semibold text-fg">{t('workflows.changes')}</h2>
          {changed.length !== request.fields.length && (
            <Link href={`/approvals/${encodeURIComponent(request.id)}${showAll ? '' : '?all=1'}`} className={`${linkClass} text-sm`} data-testid="approval-fields-toggle">
              {showAll ? t('workflows.showChanged') : t('workflows.showAll')}
            </Link>
          )}
        </div>
        <DiffTable fields={fields} t={t} locale={locale} names={names} />
      </section>

      {(can.approve || can.reject || can.withdraw || request.status === 'failed' || request.status === 'pending') && (
        <section className={`${cardClass} mb-4`} data-testid="approval-actions-card">
          {request.status === 'pending' && !can.approve && can.blocks.length > 0 && (
            <div className="mb-4" data-testid="approval-why-not">
              <h2 className="text-sm font-semibold text-fg">{t('workflows.whyNot')}</h2>
              <ul className="mt-1 list-disc ps-5 text-sm text-fg-muted">
                {[...new Set(can.blocks)].map((b) => (
                  <li key={b}>{t(`workflows.block.${b}` as MessageKey)}</li>
                ))}
              </ul>
            </div>
          )}
          <RequestActions
            id={request.id}
            version={request.version}
            title={title}
            status={request.status}
            can={can}
            // admin-api sets can.retry (#1865) from the retry route's own check
            canRetry={request.status === 'failed' && (request.can as { retry?: boolean } | undefined)?.retry === true}
            actions={{ approve: approveWorkflowRequest, reject: rejectWorkflowRequest, withdraw: withdrawWorkflowRequest, retry: retryWorkflowRequest, comment: commentOnWorkflowRequest }}
          />
        </section>
      )}

      <section className={cardClass} aria-labelledby="approval-steps">
        <h2 id="approval-steps" className="text-lg font-semibold text-fg">{t('workflows.steps')}</h2>
        <ol className="mt-3 space-y-3 border-s-2 border-border ps-4" data-testid="approval-steps">
          {request.steps.map((s) => (
            <li key={s.seq} className="text-sm" data-step={s.kind}>
              <p className="text-fg" dir="auto">
                {t(`workflows.step.${s.kind}` as MessageKey, { name: nameOf(s.actor) })}
              </p>
              <p className="text-fg-muted">
                <LocalTime value={s.at} withTime />
                {s.stepUp && (
                  <>
                    {t('common.sep')}
                    {t('workflows.stepUp')}
                  </>
                )}
              </p>
              {s.note && (
                <p className="mt-1 whitespace-pre-wrap break-words rounded border-s-2 border-border bg-surface-2 px-3 py-2 text-fg" dir="auto">
                  {s.note}
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-fg-subtle">{WORKFLOW_ACTIONS[request.type] ? (locale === 'ar' ? WORKFLOW_ACTIONS[request.type].label.ar : WORKFLOW_ACTIONS[request.type].label.en) : request.type}</p>
      </section>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <p className="mb-4 text-sm">
      <Link href="/approvals" className={linkClass} data-testid="approval-back">
        <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> {label}
      </Link>
    </p>
  );
}

/** One diff value: dates as local time with the zone (UTC on hover, the shared LocalTime); the rest as text. */
function DiffValue({ field, value, t, locale, names }: { field: WorkflowField; value: unknown; t: Parameters<typeof workflowValue>[3]; locale: Parameters<typeof workflowValue>[2]; names: Record<string, string> }) {
  if (field.kind === 'date' && (typeof value === 'string' || typeof value === 'number') && value !== '') return <LocalTime value={value} withTime />;
  // One person per line: a list of Latin names with commas reads wrongly inside Arabic
  if (field.kind === 'person' && Array.isArray(value)) {
    return (
      <ul className="list-disc sm:min-w-32 space-y-0.5 ps-4">
        {workflowPeople(value, t, names).map((name, i) => (
          <li key={String(value[i])}>
            <bdi>{name}</bdi>
          </li>
        ))}
      </ul>
    );
  }
  return <>{workflowValue(field, value, locale, t, names)}</>;
}

function DiffTable({ fields, t, locale, names }: { fields: WorkflowField[]; t: Parameters<typeof workflowValue>[3]; locale: Parameters<typeof workflowValue>[2]; names: Record<string, string> }) {
  return (
    // A phone has no room for three columns: each field's name is a line of its own, over now and after.
    // The roles keep it a table there (display: grid drops them).
    <div className="mt-3">
      <table role="table" className="w-full text-sm max-sm:block" data-testid="approval-diff">
        <thead role="rowgroup" className="max-sm:block">
          <tr role="row" className="border-b border-border text-start text-fg-muted max-sm:grid max-sm:grid-cols-2">
            <th role="columnheader" scope="col" className="py-2 pe-3 text-start font-medium max-sm:sr-only" />
            <th role="columnheader" scope="col" className="py-2 pe-3 text-start font-medium">{t('workflows.before')}</th>
            <th role="columnheader" scope="col" className="py-2 text-start font-medium">{t('workflows.after')}</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-sm:block">
          {fields.map((f) => {
            const changes = fieldChanges(f);
            return (
              <tr role="row" key={f.key} className="border-b border-border last:border-b-0 align-top max-sm:grid max-sm:grid-cols-2" data-field={f.key} data-changed={changes ? '1' : '0'}>
                <th role="rowheader" scope="row" className="py-2 pe-3 text-start font-medium text-fg max-sm:col-span-2 max-sm:pb-0">{locale === 'ar' ? f.label.ar : f.label.en}</th>
                <td role="cell" className={`min-w-0 py-2 pe-3 [overflow-wrap:anywhere] ${changes ? 'text-fg-muted line-through decoration-1' : 'text-fg-muted'}`}>
                  <DiffValue field={f} value={f.before} t={t} locale={locale} names={names} />
                </td>
                <td role="cell" className={`min-w-0 py-2 [overflow-wrap:anywhere] ${changes ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                  <DiffValue field={f} value={f.after} t={t} locale={locale} names={names} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
