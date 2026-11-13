'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatPasskeyDeadline, graceBannerKey } from '@/lib/passkeys';
import { linkClass } from './ui';

/**
 * Grace period banner (wiki AUTH-PASSKEYS): "Add a passkey by <date>", shown
 * above every admin page while the staff deadline is in the future and the
 * admin signed in without a passkey. Dismissible for this browser tab
 * (sessionStorage, per deadline); it comes back in a new tab, until a passkey sign-in.
 */
export function PasskeyGraceBanner({ deadline, setupUrl }: { deadline: number; setupUrl: string | null }) {
  const { t, locale } = useLanguage();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(graceBannerKey(deadline)) === '1') setDismissed(true);
    } catch {
      // storage blocked: the banner just stays
    }
  }, [deadline]);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(graceBannerKey(deadline), '1');
    } catch {
      // storage blocked: hidden until the next page load
    }
  };

  return (
    <div
      role="status"
      data-testid="passkey-grace-banner"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-fg"
    >
      <span className="flex-1 min-w-[12rem]">{t('passkeys.bannerText', { date: formatPasskeyDeadline(deadline, locale) })}</span>
      {setupUrl && (
        <a href={setupUrl} className={`${linkClass} font-medium`} data-testid="passkey-grace-add">
          {t('passkeys.bannerAdd')}
        </a>
      )}
      <button type="button" onClick={dismiss} className={`${linkClass} text-fg-muted`} data-testid="passkey-grace-dismiss">
        {t('passkeys.bannerDismiss')}
      </button>
    </div>
  );
}
