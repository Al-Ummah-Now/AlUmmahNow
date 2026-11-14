import type { CsamCaseSummary } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { getCsamCases, getCsamSettingsLogSafe, getCsamSettingsSafe } from './load';
import { AccessLog } from './AccessLog';
import { getAdminSession } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { CSAM_STATUS_TONE, CSAM_TONE_CLASS, needsReport, retentionLabelKey, sortCases } from './model';
import { IntakeForm, SettingsCard } from './CsamAdmin';

export const dynamic = 'force-dynamic';

/**
 * CSAM cases (docs/specs/CSAM-RESPONSE.md): paste a Cloudflare CSAM alert to open cases (mapped
 * URLs are taken down at once and the uploader frozen), the open cases with what each still needs,
 * and the owner's settings (retention, Cloudflare webhook). Super admins only; every read is
 * logged by admin-api.
 */
export default async function CsamCasesPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!isSuperAdmin(session?.user.role)) return <ErrorAlert testId="csam-no-access">{t('csamPage.noAccess')}</ErrorAlert>;

  const [cases, settings, settingsLog] = await Promise.all([getCsamCases(), getCsamSettingsSafe(), getCsamSettingsLogSafe()]);

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('csamPage.title')}</h1>
        <p className="text-fg-muted mt-1">{t('csamPage.subtitle')}</p>
      </div>

      <IntakeForm />

      <section className={`${cardClass} mb-6`} aria-labelledby="csam-cases-title" data-testid="csam-cases">
        <h2 id="csam-cases-title" className="text-lg font-semibold text-fg mb-3">
          {t('csamPage.list.title')}
        </h2>
        {cases === null ? (
          <ErrorAlert testId="csam-load-error">{t('csamPage.loadFailed')}</ErrorAlert>
        ) : cases.length === 0 ? (
          <p className="text-fg-muted" data-testid="csam-empty">
            {t('csamPage.list.empty')}
          </p>
        ) : (
          <CaseTable cases={cases} locale={locale} t={t} />
        )}
      </section>

      {settings === null ? <ErrorAlert testId="csam-settings-error">{t('csamPage.settings.loadFailed')}</ErrorAlert> : <SettingsCard settings={settings} />}

      <section className={`${cardClass} mt-6`} aria-labelledby="csam-settings-log-title" data-testid="csam-settings-log">
        <h2 id="csam-settings-log-title" className="text-lg font-semibold text-fg mb-3">
          {t('csamPage.settings.logTitle')}
        </h2>
        {settingsLog === null ? <ErrorAlert>{t('csamPage.log.loadFailed')}</ErrorAlert> : <AccessLog entries={settingsLog} t={t} locale={locale} />}
      </section>
    </div>
  );
}

function CaseTable({ cases, locale, t }: { cases: CsamCaseSummary[]; locale: Locale; t: Translator }) {
  const sorted = sortCases(cases);
  const retention = (c: CsamCaseSummary) =>
    ({
      deleted: t('csamPage.list.evidenceDeleted'),
      hold: t('csamPage.list.retainHold'),
      date: c.retainUntil ? formatDate(c.retainUntil, locale) : '',
      untilReported: t('csamPage.list.retainUntilReported'),
    })[retentionLabelKey(c)];
  const status = (c: CsamCaseSummary) => (
    <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${CSAM_TONE_CLASS[CSAM_STATUS_TONE[c.status]]}`}>{t(`csamPage.statuses.${c.status}` as MessageKey)}</span>
  );
  return (
    <>
      {/* Phones: one card per case (a five-column table leaves the URL a few letters wide) */}
      <ul className="sm:hidden divide-y divide-border" data-testid="csam-case-cards">
        {sorted.map((c) => (
          <li key={c.id} className="py-3 space-y-2" data-testid="csam-case-card" data-status={c.status}>
            <div className="flex flex-wrap items-center gap-2">
              {status(c)}
              {c.legalHold && <span className="text-xs text-fg-muted">{t('csamPage.list.hold')}</span>}
            </div>
            <Link className={`${linkClass} block break-all text-sm`} href={`/moderation/csam/${encodeURIComponent(c.id)}`}>
            <bdi dir="ltr">{c.matchedUrl}</bdi>
          </Link>
            {needsReport(c.status) && <p className="text-xs text-danger-fg">{t('csamPage.list.needsReport')}</p>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">{t('csamPage.list.colKind')}</dt>
              <dd className="text-fg">{c.itemKind ? t(`csamPage.kinds.${c.itemKind}` as MessageKey) : '—'}</dd>
              <dt className="text-fg-muted">{t('csamPage.list.colDetected')}</dt>
              <dd className="text-fg">{formatDate(c.detectedAt, locale, true)}</dd>
              <dt className="text-fg-muted">{t('csamPage.list.colRetain')}</dt>
              <dd className="text-fg">{retention(c)}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('csamPage.list.title')}</caption>
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.list.colUrl')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.list.colStatus')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.list.colKind')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.list.colDetected')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('csamPage.list.colRetain')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id} className="border-t border-border align-top" data-testid="csam-case-row" data-status={c.status}>
                <th scope="row" className="p-2 text-start font-normal max-w-md">
                  <Link className={`${linkClass} break-all`} href={`/moderation/csam/${encodeURIComponent(c.id)}`} dir="ltr" data-testid="csam-case-link">
                    {c.matchedUrl}
                  </Link>
                  {needsReport(c.status) && (
                    <span className="block text-xs text-danger-fg mt-1" data-testid="csam-needs-report">
                      {t('csamPage.list.needsReport')}
                    </span>
                  )}
                </th>
                <td className="p-2">
                  {status(c)}
                  {c.legalHold && <span className="block text-xs text-fg-muted mt-1">{t('csamPage.list.hold')}</span>}
                </td>
                <td className="p-2 text-fg-muted">{c.itemKind ? t(`csamPage.kinds.${c.itemKind}` as MessageKey) : '—'}</td>
                <td className="p-2 whitespace-nowrap text-fg-muted">{formatDate(c.detectedAt, locale, true)}</td>
                <td className="p-2 whitespace-nowrap text-fg-muted">{retention(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
