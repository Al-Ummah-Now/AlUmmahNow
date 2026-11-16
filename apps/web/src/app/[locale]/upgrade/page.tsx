import type { Metadata } from 'next';
import { UpgradePage } from '@/components/upgrade/UpgradePage';
import { getTranslations } from '@/lib/i18n/utils/getTranslations';

/** /upgrade: request a tier (wiki AUN-TIER-REQUESTS). For signed-in viewers: never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = getTranslations(locale === 'ar' ? 'ar' : 'en');
  return { title: t.upgrade.metaTitle, robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <UpgradePage locale={locale === 'ar' ? 'ar' : 'en'} />;
}
