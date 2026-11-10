import { SITE_THEMES } from '@al-ummah/shared-types';
import { getSiteThemeHistory, getSiteThemeState, type SiteThemeChange } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { SiteThemePicker, type ThemePreview } from './SiteThemePicker';

export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-require-imports */
const palette: Record<string, Record<string, string>> = {
  lantern: require('../../../../../../packages/fanous-tokens/generated/lantern/web/brand.cjs'),
  zujaj: require('../../../../../../packages/fanous-tokens/generated/zujaj/web/brand.cjs'),
  nahas: require('../../../../../../packages/fanous-tokens/generated/nahas/web/brand.cjs'),
  fawanees: require('../../../../../../packages/fanous-tokens/generated/fawanees/web/brand.cjs'),
};

export default async function SiteThemePage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const previews: ThemePreview[] = SITE_THEMES.map((id) => ({ id, swatches: Object.values(palette[id]).slice(0, 6) }));
  const [stateResult, historyResult] = await Promise.allSettled([getSiteThemeState(), getSiteThemeHistory()]);
  const state = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const history: SiteThemeChange[] | null = historyResult.status === 'fulfilled' ? historyResult.value : null;
  for (const result of [stateResult, historyResult]) {
    if (result.status === 'rejected') {
      logger.error('[site-theme] Failed to load', { error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
  }
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('siteTheme.title')}</h1>
        <p className="text-fg-muted mt-2">{t('siteTheme.subtitle')}</p>
      </div>
      {!state && <ErrorAlert testId="site-theme-error">{t('siteTheme.failed')}</ErrorAlert>}
      {state && <SiteThemePicker initial={state.theme} previews={previews} canEdit={session?.user.role === 'admin' || session?.user.role === 'super_admin'} />}
      <section className={`${cardClass} mt-8`} aria-labelledby="site-theme-history-title" data-testid="site-theme-history">
        <h2 id="site-theme-history-title" className="text-lg font-semibold text-fg mb-3">{t('siteTheme.history')}</h2>
        {!history && <p className="text-fg-muted" data-testid="site-theme-history-error">{t('siteTheme.historyUnavailable')}</p>}
        {history?.length === 0 && <p className="text-fg-muted" data-testid="site-theme-history-empty">{t('siteTheme.historyEmpty')}</p>}
        {!!history?.length && (
          <ol className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm text-fg" data-testid="site-theme-history-row" data-id={entry.id} data-old={entry.oldValue ?? ''} data-new={entry.newValue} data-actor={entry.actorId}>
                <span className="capitalize">{entry.oldValue ?? t('siteTheme.historyDefault')}</span> → <span className="capitalize font-medium">{entry.newValue}</span>
                <span className="text-fg-muted"> · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC</time> · <span dir="ltr">{entry.actorId}</span></span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
