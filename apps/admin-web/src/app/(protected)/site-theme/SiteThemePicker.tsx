'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteTheme } from '@al-ummah/shared-types';
import { setSiteTheme } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass } from '@/components/ui';

export interface ThemePreview {
  id: SiteTheme;
  swatches: string[];
}

export function SiteThemePicker({ initial, previews, canEdit }: { initial: SiteTheme; previews: ThemePreview[]; canEdit: boolean }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const choose = (theme: SiteTheme) =>
    start(async () => {
      setFailed(false);
      try {
        setCurrent((await setSiteTheme(theme)).theme);
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
        {previews.map(({ id, swatches }) => (
          <section key={id} className={cardClass} data-testid={`site-theme-${id}`} aria-current={id === current ? 'true' : undefined}>
            <h2 className="text-lg font-semibold text-fg capitalize">{id}</h2>
            <div className="flex h-12 rounded-md overflow-hidden my-3" aria-hidden="true">
              {swatches.map((colour, index) => <span key={index} className="flex-1" style={{ backgroundColor: colour }} />)}
            </div>
            {id === current
              ? <p className="text-sm font-medium text-fg">{t('siteTheme.current')}</p>
              : canEdit && <button type="button" disabled={pending} onClick={() => choose(id)} data-testid={`site-theme-apply-${id}`} className="text-sm font-medium underline text-fg">{t('siteTheme.apply')}</button>}
          </section>
        ))}
      </div>
    </>
  );
}
