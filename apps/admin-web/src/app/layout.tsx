import type { Metadata, Viewport } from 'next';
import { QueryProvider } from '@/providers/QueryProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { getI18n, getTheme } from '@/i18n/server';
import './globals.css';
import { VersionSkewProvider } from '@/lib/version-skew/VersionSkewProvider';
import { ErrorReportingProvider } from '@/lib/errors/ErrorReportingProvider';
import { appIcons } from '@/lib/favicon';
import { getSiteTheme } from '@/lib/site-theme';
import { MODE_SCRIPT } from '@/lib/color-mode';
import { FanousStreet } from '@/components/FanousStreet';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    // Staff icon (octagon seal), marked on QA and stage; read per request, one build serves both
    icons: appIcons(process.env.NEXTJS_ENV),
    manifest: '/site.webmanifest',
    // Never for search engines (also X-Robots-Tag from next.config.ts)
    robots: { index: false, follow: false },
  };
}

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const brand: Record<string, string> = require('../../../../packages/fanous-tokens/generated/lantern/web/brand.cjs');

/** Browser chrome colour per scheme, from the Fanous tokens. */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: brand.parchment },
    { media: '(prefers-color-scheme: dark)', color: brand.night },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, dir } = await getI18n();
  const [theme, siteTheme] = await Promise.all([getTheme(), getSiteTheme()]);

  // data-theme: the site's theme (the admin follows it). data-color-mode: the admin's light/dark
  // preference; MODE_SCRIPT turns it into the .dark class before first paint (src/lib/color-mode.ts).
  return (
    <html lang={locale} dir={dir} data-theme={siteTheme.id} data-color-mode={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
        {siteTheme.css && <style data-site-theme={siteTheme.id} dangerouslySetInnerHTML={{ __html: siteTheme.css }} />}
      </head>
      <body className="min-h-screen bg-bg text-fg">
        {/* A deploy while this page is open: notice + reload */}
        <VersionSkewProvider />
        {/* Browser errors → Errors page (src/lib/errors/reporter.ts) */}
        <ErrorReportingProvider locale={locale} theme={theme} />
        <I18nProvider locale={locale} theme={theme}>
          <QueryProvider>{children}</QueryProvider>
        </I18nProvider>
        {/* The site theme's lantern street (Fawanees): packages/fanous-tokens/street */}
        <FanousStreet />
      </body>
    </html>
  );
}
