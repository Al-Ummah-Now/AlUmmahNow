import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import { formatNumber, type Translator } from '@/i18n/translate';
import { linkClass } from '@/components/ui';

/**
 * "N creators hit their upload limit this week", from upload_limit_hits, with
 * links to who they are and to the tier limits. Nothing when nobody did.
 */
export function LimitHitsNotice({ count, t, locale, showWho = true }: { count: number; t: Translator; locale: Locale; showWho?: boolean }) {
  if (count <= 0) return null;
  return (
    <div role="status" data-testid="creators-notice-limited" className="mb-4 rounded border border-border border-s-4 border-s-accent bg-surface px-4 py-3 text-sm text-fg">
      {t('creators.noticeLimited', { count: formatNumber(count, locale) })}{' '}
      <span className="inline-flex flex-wrap gap-x-3">
        {showWho && <Link href="/creators?filter=limited" className={linkClass} data-testid="creators-notice-limited-who">{t('creators.noticeLimitedLink')}</Link>}
        <Link href="/creators/tiers" className={linkClass} data-testid="creators-notice-limited-raise">{t('creators.noticeLimitedRaise')}</Link>
      </span>
    </div>
  );
}
