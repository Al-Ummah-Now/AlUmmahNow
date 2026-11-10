/**
 * Presentational pieces shared by the content pages (server and client).
 * They take translated strings, like components/ui.tsx.
 */
import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import { formatDate, type Translator } from '@/i18n/translate';
import type { ContentAuditEntry, ContentReport } from '@/lib/api/content-types';
import { cardClass, linkClass } from '@/components/ui';

export type ChipTone = 'neutral' | 'good' | 'info' | 'warn' | 'bad';

const toneClasses: Record<ChipTone, string> = {
  neutral: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  good: 'bg-chip-resolved-bg text-chip-resolved-fg',
  info: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  warn: 'bg-chip-pending-bg text-chip-pending-fg',
  bad: 'bg-danger-bg text-danger-fg border border-danger-border',
};

export function Chip({ tone, children, testId, large = false }: { tone: ChipTone; children: React.ReactNode; testId?: string; large?: boolean }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded font-medium whitespace-nowrap ${large ? 'px-3 py-1' : 'px-2 py-0.5 text-xs'} ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

/** Processing status tones: failed and in-progress states stand out. */
export function statusTone(status: string | null): ChipTone {
  if (status === 'failed') return 'bad';
  if (status === 'processing' || status === 'uploading' || status === 'initiated') return 'warn';
  return 'good';
}

export const thClass = 'text-start px-3 sm:px-4 py-3 text-fg-muted font-medium whitespace-nowrap text-sm';
export const tdClass = 'px-3 sm:px-4 py-3 align-top';
/** Columns shown from the md breakpoint; on a phone their content folds into the first cell. */
export const wideOnly = 'hidden md:table-cell';
export const tableWrapClass = 'bg-surface border border-border rounded-lg overflow-x-auto';
export const smallButtonClass =
  'inline-flex items-center justify-center px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 disabled:cursor-not-allowed';
export const dangerButtonClass =
  'inline-flex items-center justify-center px-3 py-2 rounded border border-danger-border bg-danger-bg text-danger-fg text-sm font-medium hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 disabled:cursor-not-allowed';

export function PageHeader({ title, subtitle, total, t, children, deletedKind }: { title: string; subtitle: string; total?: number; t: Translator; children?: React.ReactNode; deletedKind?: string }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
      <div>
        <h1 className="text-3xl font-bold text-fg">{title}</h1>
        <p className="text-fg-muted mt-1">
          {subtitle}
          {total !== undefined && (
            <>
              {' · '}
              <span data-testid="content-total" data-total={total}>
                {t('content.total', { count: total })}
              </span>
            </>
          )}
          {deletedKind && (
            <>
              {' · '}
              <Link href={`/deleted?kind=${encodeURIComponent(deletedKind)}`} className={linkClass} data-testid="view-deleted">
                {t('deleted.viewDeleted')}
              </Link>
            </>
          )}
        </p>
      </div>
      {children}
    </div>
  );
}

const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export function Pager({ page, pageSize, total, href, t }: { page: number; pageSize: number; total: number; href: (page: number) => string; t: Translator }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('content.pagination')} className="flex justify-center items-center gap-2 mt-6">
      {page > 1 && (
        <Link href={href(page - 1)} className={pagerClass} rel="prev">
          {t('content.previous')}
        </Link>
      )}
      <span className="px-4 py-2 text-fg-muted" aria-current="page" data-testid="page-indicator">
        {t('content.pageOf', { page, total: pages })}
      </span>
      {page < pages && (
        <Link href={href(page + 1)} className={pagerClass} rel="next">
          {t('content.next')}
        </Link>
      )}
    </nav>
  );
}

/** Cursor lists (playlists, posts) move forward only; "first page" starts over. */
export function CursorPager({ hasCursor, nextHref, firstHref, labels, t }: { hasCursor: boolean; nextHref: string | null; firstHref: string; labels: { first: string; next: string }; t: Translator }) {
  if (!hasCursor && !nextHref) return null;
  return (
    <nav aria-label={t('content.pagination')} className="flex justify-center items-center gap-2 mt-6">
      {hasCursor && (
        <Link href={firstHref} className={pagerClass}>
          {labels.first}
        </Link>
      )}
      {nextHref && (
        <Link href={nextHref} className={pagerClass} rel="next">
          {labels.next}
        </Link>
      )}
    </nav>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted" data-testid="content-empty">
      {children}
    </div>
  );
}

export function Notice({ children, testId, tone = 'info' }: { children: React.ReactNode; testId?: string; tone?: 'info' | 'warn' | 'bad' }) {
  const cls = tone === 'bad' ? 'bg-danger-bg border-danger-border text-danger-fg' : tone === 'warn' ? 'bg-chip-pending-bg border-border text-chip-pending-fg' : 'bg-surface-2 border-border text-fg';
  return (
    <div role="status" data-testid={testId} className={`border rounded px-4 py-3 mb-6 ${cls}`}>
      {children}
    </div>
  );
}

/** Short, selectable id; LTR even in Arabic. */
export function MonoId({ value, max = 14 }: { value: string; max?: number }) {
  return (
    <span className="font-mono text-xs text-fg-subtle break-all" dir="ltr" title={value}>
      {value.length > max ? `${value.slice(0, max)}…` : value}
    </span>
  );
}

export function SectionCard({ title, children, testId, id }: { title: string; children: React.ReactNode; testId?: string; id?: string }) {
  return (
    <section className={cardClass} aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="text-lg font-semibold text-fg mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A row of numbers. A stat with `href` is a link to the list behind it (the
 * channel's videos, the user's channels): the label is the link and it covers
 * the whole tile, so the tile is one large target.
 */
export function StatGrid({ stats }: { stats: { label: string; value: string; testId?: string; href?: string; linkTestId?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
      {stats.map((s) => (
        <div key={s.label} className={`relative bg-surface-2 border border-border rounded p-3 ${s.href ? 'hover:border-accent focus-within:ring-2 focus-within:ring-focus' : ''}`}>
          <dt className="text-xs text-fg-muted">
            {s.href ? (
              <Link href={s.href} className="text-link hover:underline underline-offset-2 focus:outline-none after:absolute after:inset-0 after:content-['']" data-testid={s.linkTestId}>
                {s.label}
                <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
              </Link>
            ) : (
              s.label
            )}
          </dt>
          <dd className="text-xl font-semibold text-fg" data-testid={s.testId}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportsCard({ reports, t, locale }: { reports: ContentReport[]; t: Translator; locale: Locale }) {
  return (
    <SectionCard title={t('content.reports')} testId="content-reports" id="content-reports-title">
      {reports.length === 0 ? (
        <p className="text-fg-muted text-sm">{t('content.reportsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {reports.map((r) => (
            <li key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-fg text-sm">
                  <TranslatedValue t={t} prefix="reason" value={r.reason} /> · <TranslatedValue t={t} prefix="status" value={r.status} />
                </p>
                {r.description && <p className="text-fg-muted text-sm break-words" dir="auto">{r.description}</p>}
                <p className="text-fg-subtle text-xs">
                  <time dateTime={r.createdAt}>{formatDate(r.createdAt, locale, true)}</time>
                </p>
              </div>
              <Link href={`/moderation/reports/${encodeURIComponent(r.id)}`} className={`${linkClass} text-sm`}>
                {t('content.reportOpen')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function TranslatedValue({ t, prefix, value }: { t: Translator; prefix: string; value: string }) {
  const key = `${prefix}.${value}` as Parameters<Translator>[0];
  const text = t(key);
  return <>{text === key ? value : text}</>;
}

export function AuditCard({ entries, t, locale }: { entries: ContentAuditEntry[]; t: Translator; locale: Locale }) {
  return (
    <SectionCard title={t('content.audit')} testId="content-audit" id="content-audit-title">
      {entries.length === 0 ? (
        <p className="text-fg-muted text-sm">{t('content.auditEmpty')}</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="text-sm" data-testid="audit-entry" data-action={e.action}>
              <p className="text-fg">
                <span className="font-mono" dir="ltr">{e.action}</span>{' '}
                <span className="text-fg-muted">{t('content.auditBy', { actor: e.actorId })}</span>
              </p>
              {e.details && Object.keys(e.details).length > 0 && (
                <p className="text-fg-muted text-xs break-words font-mono" dir="ltr">
                  {Object.entries(e.details)
                    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                    .join(' · ')}
                </p>
              )}
              <p className="text-fg-subtle text-xs">
                <time dateTime={e.createdAt}>{formatDate(e.createdAt, locale, true)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mb-6">
      <Link href={href} className={linkClass}>
        <span aria-hidden="true" className="inline-block rtl:rotate-180">
          &larr;
        </span>{' '}
        {label}
      </Link>
    </div>
  );
}
