import Link from 'next/link';
import { getAiConfig } from '@/lib/api/admin';
import type { AiConfigView } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const { t, locale } = await getI18n();
  let config: AiConfigView | null = null;
  try {
    config = await getAiConfig();
  } catch (e) {
    logger.error('[ai-moderation] Failed to load config', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/moderation/ai" className={linkClass}>
          <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('ai.backToSignals')}
        </Link>
      </div>
      <h1 className="text-3xl font-bold text-fg mb-2">{t('ai.settingsTitle')}</h1>
      {config?.updatedAt && <p className="text-fg-muted mb-6">{t('ai.lastChanged', { date: formatDate(config.updatedAt, locale, true) })}</p>}
      {!config && <ErrorAlert testId="ai-config-error">{t('common.unknownError')}</ErrorAlert>}
      {config && <SettingsForm initial={config} />}
    </div>
  );
}
