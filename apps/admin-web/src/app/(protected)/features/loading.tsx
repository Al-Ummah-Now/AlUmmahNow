import { FEATURE_GROUPS, FEATURE_REGISTRY } from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';

/** The Features page while its list loads: the real header and one placeholder row per feature. */
export default async function FeaturesLoading() {
  const { t } = await getI18n();
  return (
    <div aria-busy="true" data-testid="features-loading">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('features.title')}</h1>
        <p className="mt-2 max-w-prose text-fg-muted">{t('features.intro')}</p>
        <p className="sr-only" role="status">
          {t('features.loading')}
        </p>
      </div>
      <div className="mb-6 h-11 max-w-xl animate-pulse rounded-lg border border-border bg-surface" aria-hidden="true" />
      <div className="space-y-6" aria-hidden="true">
        {FEATURE_GROUPS.map((group) => (
          <div key={group} className="overflow-hidden rounded-xl border border-border bg-surface" data-solid-surface>
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-5 py-3.5">
              <div className="h-4 w-40 animate-pulse rounded bg-surface-hover" />
              <div className="h-3.5 w-20 animate-pulse rounded bg-surface-hover" />
            </div>
            <ul className="divide-y divide-border">
              {FEATURE_REGISTRY.filter((d) => d.group === group).map((d) => (
                <li key={d.key} className="flex items-start justify-between gap-4 px-5 py-5">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-44 animate-pulse rounded bg-surface-2" />
                    <div className="h-3.5 w-full max-w-2xl animate-pulse rounded bg-surface-2" />
                    <div className="h-3.5 w-2/3 max-w-xl animate-pulse rounded bg-surface-2" />
                  </div>
                  <div className="mt-1 h-6 w-24 animate-pulse rounded-full bg-surface-2" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
