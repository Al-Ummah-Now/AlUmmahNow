'use client';

/**
 * Live streaming and the channel owner's creator tier (api-videos lib/live/tier-gate.ts):
 * why the owner can't go live (no tier, a tier without live, the month's hours used) with
 * "Request access" to /{lang}/upgrade, or, when they can, how much of the month is left.
 */
import { numberFormat } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import type { LiveAccess } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

export const upgradeHref = (locale: string) => `/${locale === 'ar' ? 'ar' : 'en'}/upgrade`;

const hours = (minutes: number, locale: string) =>
  numberFormat(locale === 'ar' ? 'ar' : 'en', { maximumFractionDigits: 1 }).format(Math.round((minutes / 60) * 10) / 10);

/** Shown above the stream list instead of the form when the tier does not allow going live. */
export function LiveTierNotice({ locale, live }: { locale: string; live: LiveAccess }) {
  const { t } = useLanguage();
  const text = t.studio.live.gate;
  const num = (n: number) => numberFormat(locale === 'ar' ? 'ar' : 'en').format(n);

  if (live.allowed) {
    if (live.unlimited || live.hoursMonth === null) return null;
    return (
      <p className="mb-4 text-sm text-muted-foreground" data-testid="studio-live-usage">
        {text.usage
          .replace('{used}', hours(live.usedMinutes, locale))
          .replace('{hours}', num(live.hoursMonth))
          .replace('{minutes}', num(live.maxStreamMinutes ?? 0))}
      </p>
    );
  }

  const canRequest = live.reason === 'no_tier' || live.reason === 'not_in_tier';
  const title = live.reason === 'hours_used' ? text.hoursUsedTitle : text.notInTierTitle;
  const body =
    live.reason === 'hours_used'
      ? text.hoursUsedBody.replace('{used}', hours(live.usedMinutes, locale)).replace('{hours}', num(live.hoursMonth ?? 0))
      : live.reason === 'pending_deletion'
        ? text.pendingDeletionBody
        : live.reason === 'no_tier'
          ? text.noTierBody
          : text.notInTierBody;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4" data-testid="studio-live-gate" data-reason={live.reason ?? ''} aria-labelledby="studio-live-gate-title">
      <h2 id="studio-live-gate-title" className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {canRequest && (
        <Button asChild className="mt-3 min-h-11">
          <Link href={upgradeHref(locale)} data-testid="studio-live-request-access">{text.requestAccess}</Link>
        </Button>
      )}
    </section>
  );
}

/** "Request access" after a refusal the server answered with live_not_in_tier (Go live, create). */
export function LiveRequestAccessLink({ locale }: { locale: string }) {
  const { t } = useLanguage();
  return (
    <Link href={upgradeHref(locale)} className="ms-1 font-medium underline" data-testid="studio-live-request-access">
      {t.studio.live.gate.requestAccess}
    </Link>
  );
}
