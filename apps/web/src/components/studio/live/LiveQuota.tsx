'use client';

/**
 * The owner's live quota on Studio → Live, as a plain fact (wiki "Product rules → Hidden when off"):
 * how much of the month's live hours is used, or that this month's hours are used, or that the
 * account is being deleted. No upsell and no link: a tier without live never reaches this page
 * (GET /api/me/features hides Live).
 */
import { formatNumber, type LiveAccess } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

const hours = (minutes: number, locale: string) =>
  formatNumber(locale, Math.round((minutes / 60) * 10) / 10, { maximumFractionDigits: 1 });

/** Null when there is nothing to say (unlimited, or a reason Live is hidden for anyway). */
export function liveQuotaText(live: LiveAccess, locale: string, text: { usage: string; hoursUsedBody: string; pendingDeletionBody: string }): string | null {
  const num = (n: number) => formatNumber(locale, n);
  if (live.allowed) {
    if (live.unlimited || live.hoursMonth === null) return null;
    return text.usage
      .replace('{used}', hours(live.usedMinutes, locale))
      .replace('{hours}', num(live.hoursMonth))
      .replace('{minutes}', num(live.maxStreamMinutes ?? 0));
  }
  if (live.reason === 'hours_used') return text.hoursUsedBody.replace('{used}', hours(live.usedMinutes, locale)).replace('{hours}', num(live.hoursMonth ?? 0));
  if (live.reason === 'pending_deletion') return text.pendingDeletionBody;
  return null;
}

export function LiveQuota({ locale, live }: { locale: string; live: LiveAccess }) {
  const { t } = useLanguage();
  const line = liveQuotaText(live, locale, t.studio.live.quota);
  if (!line) return null;
  return (
    <p className="mb-4 text-sm text-muted-foreground" data-testid="studio-live-quota" data-reason={live.allowed ? 'usage' : live.reason ?? ''}>
      {line}
    </p>
  );
}
