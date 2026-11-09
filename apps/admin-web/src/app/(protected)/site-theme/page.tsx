import { SITE_THEMES } from '@al-ummah/shared-types';
import { getSiteThemeState } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
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
  let state = null;
  try {
    state = await getSiteThemeState();
  } catch (e) {
    logger.error('[site-theme] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('siteTheme.title')}</h1>
        <p className="text-fg-muted mt-2">{t('siteTheme.subtitle')}</p>
      </div>
      {!state && <ErrorAlert testId="site-theme-error">{t('siteTheme.failed')}</ErrorAlert>}
      {state && <SiteThemePicker initial={state.theme} previews={previews} canEdit={session?.user.role === 'admin' || session?.user.role === 'super_admin'} />}
    </div>
  );
}
