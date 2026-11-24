'use client';

/**
 * Where a feature's own switch used to be (Captions settings, Social, Platform settings, Category
 * suggestions, Tier requests): one line, "Transcription is on · Change on the Features page", that
 * links to its row (wiki AUN-FEATURES §3). The setup on those pages stays.
 */
import { featureDefinition, type FeatureKey } from '@al-ummah/shared-types';
import type { FeatureItem } from '@/lib/api/features';
import { useLanguage } from '@/i18n/I18nProvider';
import AppLink from '@/components/AppLink';
import { Icon } from '@/components/shell/icons';
import { linkClass } from '@/components/ui';

export function FeatureStatusLine({ featureKey, item, className = '' }: { featureKey: FeatureKey; item: Pick<FeatureItem, 'effective'> | null | undefined; className?: string }) {
  const { t, locale } = useLanguage();
  const name = featureDefinition(featureKey).name[locale];
  return (
    <p className={`flex flex-wrap items-center gap-x-1 text-sm text-fg ${className}`} data-testid={`feature-status-line-${featureKey}`} data-effective={item ? String(item.effective) : ''}>
      <Icon name="toggle" className="me-1 size-4 shrink-0 text-fg-muted" />
      {item && (
        <>
          <span className="font-medium">
            {t(item.effective ? 'features.statusLine.on' : 'features.statusLine.off', { name })}
            {/* An Arabic comma touches the word before it; the English dot stands between the two */}
            {locale === 'ar' && <span className="text-fg-muted">{t('features.statusLine.separator').trim()}</span>}
          </span>
          {locale !== 'ar' && <span className="text-fg-muted">{t('features.statusLine.separator')}</span>}
        </>
      )}
      <AppLink href={`/features#${featureKey}`} className={linkClass}>
        {t('features.statusLine.change')}
      </AppLink>
    </p>
  );
}
