import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UpgradePage } from '@/components/upgrade/UpgradePage';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';
import { apiRequestServerResult, buildApiUrl } from '@/lib/api/api-client';

/** /upgrade: request or buy a tier (wiki AUN-TIER-REQUESTS, AUN-SUBS). For signed-in viewers: never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  return { title: t.upgrade.metaTitle, robots: { index: false, follow: false } };
}

/**
 * With tier requests off and no payment provider on ('closed'), /upgrade is an off feature: the API answers
 * 404 feature_off and the page is the site's 404, with no entry point anywhere (owner decision 2026-11-19).
 * The mode is site-wide, so the anonymous overview decides; any other failure still renders the page, which
 * shows its own error and retry.
 */
async function upgradeIsOff(): Promise<boolean> {
  const res = await apiRequestServerResult<unknown>(
    { method: 'GET', url: buildApiUrl('/api/tiers/upgrade'), functionName: 'upgradePageMode' },
    async () => null,
    false,
  );
  return res.status === 404;
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (await upgradeIsOff()) notFound();
  return <UpgradePage locale={locale === 'ar' ? 'ar' : 'en'} />;
}
