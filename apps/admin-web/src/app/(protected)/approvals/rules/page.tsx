import { WORKFLOW_DOMAINS, type WorkflowActionType, type WorkflowDomain } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { ErrorAlert, cardClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { RuleEditor } from '@/components/workflows/RuleEditor';
import { getI18n } from '@/i18n/server';
import { formatNumber, translateDynamic } from '@/i18n/translate';
import { getWorkflowActions, getWorkflowRuleHistory, proposeWorkflowRule, type WorkflowActionInfo, type WorkflowRuleVersion } from '@/lib/api/workflows';
import { logger } from '@/lib/logger';
import { getNames } from '@/lib/api/audit';
import { permissionLabel, ruleSummary } from '@/lib/workflows';

export const dynamic = 'force-dynamic';

/**
 * Approval rules (wiki AUN-WORKFLOWS §4, §10): one card per area, one row per kind of change (and per
 * scope, such as one feature switch) with its rule in one line. Edit opens the in-app dialog; saving
 * asks for approval (a rule change is itself a request), and nothing below the rule's minimum can be
 * chosen. History lists the earlier versions.
 */
export default async function ApprovalRulesPage({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const { t, locale } = await getI18n();
  const { history } = await searchParams;
  let actions: WorkflowActionInfo[] | null = null;
  try {
    actions = await getWorkflowActions();
  } catch (error) {
    logger.error('[approval-rules] Failed to load', { error: error instanceof Error ? error.message : String(error) });
  }
  const [historyType, historyScope = ''] = history ? (decodeURIComponent(history).split('|') as [WorkflowActionType, string?]) : [];
  let versions: WorkflowRuleVersion[] | null = null;
  if (historyType) versions = await getWorkflowRuleHistory(historyType, historyScope).catch(() => null);
  const perm = permissionLabel(t);
  // Named approvers are shown by name, never by id
  const named = new Set<string>();
  for (const action of actions ?? []) for (const r of action.rules) for (const set of r.config.approvers) if (set.kind === 'people') set.userIds.forEach((u) => named.add(u));
  const lookup = named.size ? await getNames({ users: [...named].slice(0, 100) }).catch(() => null) : null;
  const names: Record<string, string> = {};
  for (const [uid, u] of Object.entries(lookup?.users ?? {})) if (u.name) names[uid] = u.name;

  // Rows are grouped by the rule's own floor: a money scope (the creatorSupport switch) sits with money
  const byDomain = new Map<WorkflowDomain, { action: WorkflowActionInfo; rule: WorkflowActionInfo['rules'][number] }[]>();
  for (const action of actions ?? []) {
    for (const rule of action.rules) {
      const domain: WorkflowDomain = rule.floor.money ? 'money' : action.domain;
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), { action, rule }]);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('workflows.rules.title')}</h1>
          <p className="text-fg-muted mt-2 max-w-prose">{t('workflows.rules.subtitle')}</p>
        </div>
        <Link href="/approvals" className={`${secondaryButtonClass} shrink-0 self-start`} data-testid="approval-rules-back">
          {t('workflows.rules.back')}
        </Link>
      </div>
      {!actions && <ErrorAlert testId="approval-rules-error">{t('workflows.rules.loadFailed')}</ErrorAlert>}
      <div className="space-y-6">
        {WORKFLOW_DOMAINS.filter((d) => byDomain.has(d)).map((domain) => (
          <section key={domain} className={cardClass} aria-labelledby={`rules-${domain}`} data-testid={`approval-rules-${domain}`}>
            <h2 id={`rules-${domain}`} className="text-lg font-semibold text-fg">{translateDynamic(t, 'workflows.domain', domain)}</h2>
            <ul className="mt-3 divide-y divide-border">
              {byDomain.get(domain)!.map(({ action, rule }) => {
                const key = `${action.type}|${rule.scope}`;
                const name = locale === 'ar' ? action.label.ar : action.label.en;
                return (
                  <li key={key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between" data-testid="approval-rule-row" data-action={action.type} data-scope={rule.scope}>
                    <div className="min-w-0">
                      <h3 className="font-medium text-fg">
                        {name}
                        {action.scoped && (
                          <span className="ms-2 rounded border border-border px-1.5 py-0.5 text-xs text-fg-muted" dir="ltr">
                            {rule.scope || t('workflows.rules.scopeDefault')}
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-fg-muted" data-testid="approval-rule-summary">{ruleSummary(rule.config, t, locale, perm)}</p>
                      <p className="mt-1 text-xs text-fg-subtle">
                        {rule.floor.minApprovals > 0 ? t('workflows.rules.floorNote', { count: rule.floor.minApprovals }) : t('workflows.rules.floorNone')}
                        {rule.floor.money && (
                          <>
                            {t('common.sep')}
                            {t('workflows.rules.floorMoney')}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2 ms-auto">
                      <Link href={`/approvals/rules?history=${encodeURIComponent(key)}#history`} className={`${linkClass} self-center text-sm`} data-testid="approval-rule-history">
                        {t('workflows.rules.history')}
                      </Link>
                      {action.connected === false ? (
                        <span className="self-center text-xs text-fg-subtle" data-testid="approval-rule-not-connected">{t('workflows.rules.notConnected')}</span>
                      ) : (
                        <RuleEditor type={action.type} scope={rule.scope} actionName={name} rule={rule.config} floor={rule.floor} propose={proposeWorkflowRule} names={names} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {historyType && (
          <section id="history" className={cardClass} aria-labelledby="rules-history" data-testid="approval-rule-versions">
            <h2 id="rules-history" className="text-lg font-semibold text-fg">{t('workflows.rules.historyTitle')}</h2>
            {versions && versions.length === 0 && <p className="mt-2 text-sm text-fg-muted">{t('workflows.rules.historyEmpty')}</p>}
            {versions && versions.length > 0 && (
              <ol className="mt-3 space-y-3">
                {versions.map((v) => (
                  <li key={v.id} className="text-sm">
                    <p className="font-medium text-fg">
                      {fillNodes(t('workflows.rules.historyVersion', { version: formatNumber(v.version, locale) }), { date: <LocalTime value={v.created_at} withTime /> })}
                    </p>
                    <p className="text-fg-muted">{ruleSummary(v.config, t, locale, perm)}</p>
                    {v.request_id && (
                      <Link href={`/approvals/${encodeURIComponent(v.request_id)}`} className={`${linkClass} text-xs`}>
                        {t('workflows.steps')}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
