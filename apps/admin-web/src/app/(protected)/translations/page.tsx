import { TranslationEditor } from './components/TranslationEditor';
import { getI18nMetadata } from '@/lib/api/i18n';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TranslationsPage() {
  const { t, locale } = await getI18n();
  // getI18nMetadata logs and returns null on failure
  const metadata = await getI18nMetadata();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('translations.title')}</h1>
        <p className="text-fg-muted mt-2">{t('translations.subtitle')}</p>
      </div>

      {!metadata && <ErrorAlert testId="metadata-error">{t('errors.loadMetadata')}</ErrorAlert>}

      {metadata && (
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className={cardClass} data-testid="metadata-version">
            <dt className="text-fg-muted text-sm font-medium">{t('translations.version')}</dt>
            <dd className="text-2xl font-bold text-fg mt-2" dir="ltr">{metadata.version}</dd>
          </div>
          <div className={cardClass} data-testid="metadata-locales">
            <dt className="text-fg-muted text-sm font-medium">{t('translations.languages')}</dt>
            <dd className="text-2xl font-bold text-fg mt-2" dir="ltr">{metadata.locales.join(', ').toUpperCase()}</dd>
          </div>
          <div className={cardClass} data-testid="metadata-sections">
            <dt className="text-fg-muted text-sm font-medium">{t('translations.sections')}</dt>
            <dd className="text-2xl font-bold text-fg mt-2">{formatNumber(metadata.sections.length, locale)}</dd>
          </div>
        </dl>
      )}

      <TranslationEditor availableLocales={metadata?.locales || ['en', 'ar']} />
    </div>
  );
}
