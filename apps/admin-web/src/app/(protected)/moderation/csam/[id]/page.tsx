import { notFound } from 'next/navigation';
import type { CsamCaseDetail } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { getAdminSession } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import type { Locale } from '@/i18n/config';
import { formatDate, translateDynamic, type MessageKey, type Translator } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { getCsamCaseLogSafe, getCsamCaseSafe } from '../load';
import { CSAM_STATUS_TONE, CSAM_TONE_CLASS, caseActions, csamDownloadHref, csamFactRows } from '../model';
import { AccessLog } from '../AccessLog';
import { HoldForm, MapForm, ReportChecklist, ReportedForm, RetryButton } from './CaseActions';

export const dynamic = 'force-dynamic';

const DOWNLOAD_ERRORS = new Set(['evidence_deleted', 'evidence_key_missing', 'not_found']);

/**
 * One CSAM case (docs/specs/CSAM-RESPONSE.md): what was matched and taken down, the uploader's
 * freeze, the takedown job, the preserved evidence (downloads need a fresh sign-in), the NCMEC
 * CyberTipline checklist with the report's fields pre-filled, "Reported" with the report id, the
 * legal hold and the case's access log. Super admins only; opening it is logged.
 */
export default async function CsamCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ download?: string }> }) {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!isSuperAdmin(session?.user.role)) return <ErrorAlert testId="csam-no-access">{t('csamPage.noAccess')}</ErrorAlert>;
  const { id } = await params;
  const { download } = await searchParams;

  const c = await getCsamCaseSafe(id);
  if (c === 'not_found') notFound();
  if (c === null) return <ErrorAlert testId="csam-case-load-error">{t('csamPage.loadFailed')}</ErrorAlert>;
  const log = await getCsamCaseLogSafe(id);
  const can = caseActions(c);
  const kindLabel = (kind: string) => t(`csamPage.kinds.${kind}` as MessageKey);
  const facts = csamFactRows(c.facts, kindLabel);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/moderation/csam" className={linkClass}>{t('csamPage.back')}</Link>
        <h1 className="text-3xl font-bold text-fg mt-2">{t('csamPage.caseTitle')}</h1>
        <p className="text-fg-muted break-all mt-1" data-testid="csam-case-url"><bdi dir="ltr">{c.matchedUrl}</bdi></p>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-block rounded border px-2 py-0.5 text-sm font-medium ${CSAM_TONE_CLASS[CSAM_STATUS_TONE[c.status]]}`} data-testid="csam-case-status" data-status={c.status}>
            {t(`csamPage.statuses.${c.status}` as MessageKey)}
          </span>
          <span className="text-sm text-fg-muted">{t('csamPage.detail.sourceDetected', { source: t(`csamPage.sources.${c.source}` as MessageKey), date: formatDate(c.detectedAt, locale, true) })}</span>
        </p>
      </div>

      {download && <ErrorAlert testId="csam-download-error">{t(DOWNLOAD_ERRORS.has(download) ? (`csamPage.evidence.errors.${download}` as MessageKey) : 'csamPage.evidence.errors.failed')}</ErrorAlert>}

      {can.map && <MapForm caseId={c.id} />}

      <section className={cardClass} aria-labelledby="csam-takedown-title" data-testid="csam-takedown">
        <h2 id="csam-takedown-title" className="text-lg font-semibold text-fg mb-3">{t('csamPage.detail.takedownTitle')}</h2>
        <Takedown c={c} t={t} locale={locale} />
        {can.retry && <RetryButton caseId={c.id} />}
      </section>

      <ReportChecklist caseId={c.id} rows={facts} reported={c.status === 'reported' || c.status === 'closed'} canDownload={can.download} files={c.evidence?.files.map((f) => f.name) ?? []} />

      {can.report && <ReportedForm caseId={c.id} reportId={c.reportId} reportedAt={c.reportedAt} timeFixed={can.reportTimeFixed} />}

      <section className={cardClass} aria-labelledby="csam-evidence-title" data-testid="csam-evidence">
        <h2 id="csam-evidence-title" className="text-lg font-semibold text-fg mb-1">{t('csamPage.evidence.title')}</h2>
        <p className="text-sm text-fg-muted mb-3">{t('csamPage.evidence.note')}</p>
        <Evidence c={c} t={t} locale={locale} />
      </section>

      {can.hold && <HoldForm caseId={c.id} on={c.legalHold} reason={c.legalHoldReason} />}

      <section className={cardClass} aria-labelledby="csam-log-title" data-testid="csam-log">
        <h2 id="csam-log-title" className="text-lg font-semibold text-fg mb-1">{t('csamPage.log.title')}</h2>
        <p className="text-sm text-fg-muted mb-3">{t('csamPage.log.note')}</p>
        {log === null ? <ErrorAlert>{t('csamPage.log.loadFailed')}</ErrorAlert> : <AccessLog entries={log} t={t} locale={locale} />}
      </section>
    </div>
  );
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 border-t border-border first:border-t-0 sm:grid-cols-3" data-testid={testId}>
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg sm:col-span-2 break-words">{children}</dd>
    </div>
  );
}

function Takedown({ c, t, locale }: { c: CsamCaseDetail; t: Translator; locale: Locale }) {
  const r = c.resolution;
  const freeze = c.freeze;
  const job = c.job;
  return (
    <dl>
      <Row label={t('csamPage.detail.item')} testId="csam-item">
        {r ? (
          <>
            {t(`csamPage.kinds.${r.kind}` as MessageKey)}
            {(r.videoId || r.postId) && <span className="text-fg-muted"> · <bdi dir="ltr">{r.videoId ?? r.postId}</bdi></span>}
          </>
        ) : (
          t('csamPage.detail.unmapped')
        )}
      </Row>
      <Row label={t('csamPage.detail.uploader')} testId="csam-uploader">
        {c.uploaderId ? (
          <Link href={`/users/${encodeURIComponent(c.uploaderId)}`} className={linkClass}><bdi dir="ltr">{c.uploaderId}</bdi></Link>
        ) : (
          t('csamPage.detail.noUploader')
        )}
      </Row>
      <Row label={t('csamPage.freeze.title')} testId="csam-freeze">
        {!freeze ? (
          t('csamPage.freeze.notYet')
        ) : (
          <ul className="space-y-1">
            <li>{t('csamPage.freeze.ban')}: {freeze.ban ? t(`csamPage.freeze.banStates.${freeze.ban}` as MessageKey) : t('csamPage.freeze.pending')}</li>
            {c.authRequests.map((a) => (
              <li key={a.id} data-testid="csam-auth-request" data-action={a.action}>
                {t(`csamPage.freeze.${a.action === 'revoke_sessions' ? 'revokeSessions' : 'suspendAccount'}`)}: {a.status ? translateDynamic(t, 'authRequests.status', a.status) : translateDynamic(t, 'authRequests.delivery', a.deliveryStatus)}
              </li>
            ))}
            {freeze.error && <li className="text-danger-fg">{t('csamPage.freeze.failed')}</li>}
          </ul>
        )}
      </Row>
      <Row label={t('csamPage.job.title')} testId="csam-job">
        {!job ? (
          t('csamPage.job.none')
        ) : (
          <span data-status={job.status}>
            {t(`csamPage.job.statuses.${job.status}` as MessageKey)}
            {job.phase && <span className="text-fg-muted"> · {t('csamPage.job.phase', { phase: translateDynamic(t, 'csamPage.job.phases', job.phase.replace(/-/g, '_')) })}</span>}
            <span className="text-fg-muted"> · {t('csamPage.job.attempts', { count: job.attempts })}</span>
            {job.lastError && <span className="block text-danger-fg"><bdi dir="ltr">{job.lastError}</bdi></span>}
          </span>
        )}
      </Row>
      {c.reportedAt && (
        <Row label={t('csamPage.detail.reported')} testId="csam-reported">
          <bdi dir="ltr">{c.reportId}</bdi> · {formatDate(c.reportedAt, locale, true)}
        </Row>
      )}
      <Row label={t('csamPage.detail.retainUntil')}>
        {c.evidenceDeletedAt
          ? t('csamPage.detail.evidenceDeletedOn', { date: formatDate(c.evidenceDeletedAt, locale) })
          : c.retainUntil
            ? formatDate(c.retainUntil, locale)
            : c.legalHold
              ? t('csamPage.detail.retainHold')
              : t('csamPage.detail.retainUntilReported')}
      </Row>
    </dl>
  );
}

function bytes(n: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${units[i]}`;
}

function Evidence({ c, t, locale }: { c: CsamCaseDetail; t: Translator; locale: Locale }) {
  if (c.evidenceDeletedAt) return <p className="text-fg-muted">{t('csamPage.detail.evidenceDeletedOn', { date: formatDate(c.evidenceDeletedAt, locale) })}</p>;
  if (!c.evidence) return <p className="text-fg-muted" data-testid="csam-evidence-none">{t('csamPage.evidence.none')}</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {c.evidence.files.map((f) => (
          <li key={f.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2" data-testid="csam-evidence-file">
            <span className="text-sm break-all">
              <bdi dir="ltr" className="font-mono text-fg">{f.name}</bdi>
              <span className="text-fg-muted"> · <bdi dir="ltr">{bytes(f.bytes, locale)}</bdi></span>
            </span>
            {/* A plain link (no download attribute): a refused download sends the browser to sign in again */}
            <a href={csamDownloadHref(c.id, f.name)} className={linkClass} rel="noreferrer" data-testid="csam-evidence-download">
              {t('csamPage.evidence.download')}
            </a>
          </li>
        ))}
      </ul>
      {c.evidence.missing.length > 0 && (
        <div className="mt-3" data-testid="csam-evidence-missing">
          <p className="text-sm font-medium text-fg">{t('csamPage.evidence.missing')}</p>
          <ul className="list-disc ms-5 text-sm text-fg-muted">
            {c.evidence.missing.map((m) => (
              <li key={m.name}><bdi dir="ltr">{m.name}: {m.reason}</bdi></li>
            ))}
          </ul>
        </div>
      )}
      {!c.evidence.completedAt && <p className="text-sm text-fg-muted mt-3">{t('csamPage.evidence.copying')}</p>}
    </>
  );
}
