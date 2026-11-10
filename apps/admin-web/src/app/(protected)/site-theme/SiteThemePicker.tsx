'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSiteTheme } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass } from '@/components/ui';

export interface ThemePreview {
  id: string;
  /** Display name; built-ins show their id */
  name: string;
  /** The published version to use for a theme package; null for a built-in */
  version: string | null;
  swatches: string[];
}

/** Built-in themes and published theme packages; the chosen one becomes the site theme. */
export function SiteThemePicker({ initial, previews, canEdit }: { initial: { theme: string; version: string | null }; previews: ThemePreview[]; canEdit: boolean }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const choose = (theme: string, version: string | null) =>
    start(async () => {
      setFailed(false);
      try {
        const state = await setSiteTheme(theme, version);
        setCurrent({ theme: state.theme, version: state.version ?? null });
        // Re-reads the page so the recent changes list shows this change
        router.refresh();
      } catch {
        setFailed(true);
      }
    });
  return (
    <>
      {failed && <ErrorAlert testId="site-theme-failed">{t('siteTheme.failed')}</ErrorAlert>}
      {!canEdit && <p className="text-fg-muted mb-4" data-testid="site-theme-admin-only">{t('siteTheme.adminOnly')}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6" data-testid="site-theme-options">
        {previews.map(({ id, name, version, swatches }) => {
          const isCurrent = id === current.theme && (version === null || version === current.version);
          return (
            <section key={id} className={cardClass} data-testid={`site-theme-${id}`} aria-current={isCurrent ? 'true' : undefined}>
              <h2 className="text-lg font-semibold text-fg capitalize">{name}{version && <span className="text-sm font-normal text-fg-muted"> {version}</span>}</h2>
              <div className="flex h-12 rounded-md overflow-hidden my-3" aria-hidden="true">
                {swatches.map((colour, index) => <span key={index} className="flex-1" style={{ backgroundColor: colour }} />)}
              </div>
              {isCurrent
                ? <p className="text-sm font-medium text-fg">{t('siteTheme.current')}</p>
                : canEdit && <button type="button" disabled={pending} onClick={() => choose(id, version)} data-testid={`site-theme-apply-${id}`} className="text-sm font-medium underline text-fg">{t('siteTheme.apply')}</button>}
            </section>
          );
        })}
      </div>
    </>
  );
}
