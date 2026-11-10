import type { Metadata } from 'next';
import { QueryProvider } from '@/providers/QueryProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { getI18n, getTheme } from '@/i18n/server';
import './globals.css';
import { VersionSkewProvider } from '@/lib/version-skew/VersionSkewProvider';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('meta.title'),
    description: t('meta.description'),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, dir } = await getI18n();
  const theme = await getTheme();

  return (
    <html lang={locale} dir={dir} data-theme={theme === 'system' ? undefined : theme}>
      <body className="min-h-screen bg-bg text-fg">
        {/* A deploy while this page is open: notice + reload */}
        <VersionSkewProvider />
        <I18nProvider locale={locale} theme={theme}>
          <QueryProvider>{children}</QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
