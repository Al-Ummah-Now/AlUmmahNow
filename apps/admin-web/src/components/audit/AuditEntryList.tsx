/**
 * Audit rows as people read them (issue #745): the action in words, who did it by name (email
 * beside it, linking to their user page), the item and every id-valued detail by name, and the
 * stored record one click away. Used by the item pages' Admin history and by the /audit page.
 */
import type { AdminNames } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { type MessageKey, type Translator } from '@/i18n/translate';
import { MonoId } from '@/components/content/parts';
import { actionLabel, detailKeyLabel, detailText, detailViews, itemView, paymentsLine, personView, settingLabel, splitTemplate, type AuditTierNames } from './audit-model';
import { ItemName, PersonName } from './Named';

import { LocalTime } from '@/components/LocalTime';
export interface AuditEntryLike {
  id: string;
  action: string;
  actorId: string;
  actorEmail?: string | null;
  details: Record<string, unknown> | null;
  previous?: Record<string, unknown> | null;
  createdAt: string;
  area?: string;
  target?: { kind: string; id: string } | null;
  setting?: string | null;
}

function Details({ entry, names, t }: { entry: AuditEntryLike; names: AdminNames | null; t: Translator }) {
  const views = detailViews(entry.details, names, t);
  if (!views.length && !entry.previous) return null;
  return (
    <>
      {views.length > 0 && (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="audit-details">
          {views.map((d) => (
            <div key={d.key} className="flex flex-wrap items-baseline gap-1 min-w-0">
              <dt className="text-fg-subtle" title={d.key}>
                {detailKeyLabel(d.key, t)}
              </dt>
              <dd className="text-fg-muted min-w-0 break-words">
                {d.type === 'ref' ? (
                  d.item.kind === 'user' ? (
                    <PersonName person={personView(d.item.id, names, t)} showEmail={false} testId="audit-detail-ref" />
                  ) : (
                    <ItemName item={d.item} testId="audit-detail-ref" />
                  )
                ) : (
                  <span dir="auto">{d.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {entry.previous && Object.keys(entry.previous).length > 0 && (
        <p className="mt-1 text-xs text-fg-subtle break-words" dir="auto">
          {t('auditLog.previous', { value: Object.entries(entry.previous).map(([k, v]) => (k === 'value' ? detailText(v) : `${k}: ${detailText(v)}`)).join(' • ') })}
        </p>
      )}
    </>
  );
}

/** One row's text parts, shared by the list and the table. */
export function AuditWhat({ entry, names, t, showTarget, locale, tiers }: { entry: AuditEntryLike; names: AdminNames | null; t: Translator; showTarget: boolean; locale?: Locale; tiers?: AuditTierNames }) {
  // Payments rows read as one sentence (names, never codes); their stored values stay one click away
  const pay = locale ? paymentsLine(entry, t, locale, tiers) : null;
  return (
    <div className="min-w-0">
      {pay ? (
        <p className="text-fg" data-testid="audit-payments-line">
          <span className="font-medium" data-testid="audit-action-label">
            {splitTemplate(pay.template, ['user']).map((part, i) =>
              typeof part === 'string' ? <span key={i}>{part}</span> : <PersonName key={i} person={personView(pay.user ?? '', names, t)} showEmail={false} testId="audit-target" />,
            )}
          </span>
          {pay.undone && <span className="ms-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted" data-testid="audit-undone">{t('auditLog.payments.undone')}</span>}
        </p>
      ) : (
      <>
      <p className="text-fg">
        <span className="font-medium" data-testid="audit-action-label">
          {actionLabel(entry.action, t)}
        </span>
        {entry.setting && <span className="text-fg-muted"> • {t('auditLog.setting', { name: settingLabel(entry.setting, t) })}</span>}
        {showTarget && entry.target && (
          <>
            <span className="text-fg-muted"> • {kindLabel(entry.target.kind, t)} </span>
            <ItemName item={itemView(entry.target.kind, entry.target.id, names, t)} testId="audit-target" />
          </>
        )}
      </p>
      <Details entry={entry} names={names} t={t} />
      </>
      )}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer min-h-6 py-0.5 text-fg-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded w-fit">{t('auditLog.showRaw')}</summary>
        <pre className="mt-1 p-2 bg-surface-2 border border-border rounded overflow-x-auto font-mono text-fg-muted" dir="ltr">
          {JSON.stringify({ action: entry.action, details: entry.details, previous: entry.previous ?? null }, null, 2)}
        </pre>
        <p className="mt-1">
          <MonoId value={entry.id} max={60} />
        </p>
      </details>
    </div>
  );
}

export function kindLabel(kind: string, t: Translator): string {
  const key = `auditLog.kinds.${kind}` as MessageKey;
  const text = t(key);
  return text === key ? kind : text;
}

export function AuditEntryList({ entries, names, t, locale, showTarget = false, tiers }: { entries: AuditEntryLike[]; names: AdminNames | null; t: Translator; locale: Locale; showTarget?: boolean; tiers?: AuditTierNames }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="text-sm" data-testid="audit-entry" data-action={e.action}>
          <AuditWhat entry={e} names={names} t={t} showTarget={showTarget} locale={locale} tiers={tiers} />
          <p className="text-fg-subtle text-xs mt-0.5 flex flex-wrap gap-x-1 items-baseline">
            <span>{t('auditLog.by')}</span>
            <PersonName person={personView(e.actorId, names, t, e.actorEmail ?? null)} testId="audit-actor" />
            <span aria-hidden="true">•</span>
            <LocalTime value={e.createdAt} withTime />
          </p>
        </li>
      ))}
    </ol>
  );
}
