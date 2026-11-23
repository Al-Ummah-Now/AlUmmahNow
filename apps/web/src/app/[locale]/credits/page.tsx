import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CreditsPage } from '@/components/credits/CreditsPage';
import { CREDITS_COPY } from '@/lib/credits/copy';
import { loadQuranCredits } from '@/lib/credits/quran-credits';

/**
 * Credits (/[locale]/credits): Quran Foundation's attribution and every translation edition in use
 * (QF 2026-11-23). Read per request: the editions follow the admin's and the channels' picks. A 404
 * while no Quran text from QF is shown on this site (the rail hides its link then too).
 */
export const dynamic = 'force-dynamic';

const lang = (locale: string): 'en' | 'ar' => (locale === 'ar' ? 'ar' : 'en');

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const c = CREDITS_COPY[lang((await params).locale)];
  return { title: c.title, description: c.lead };
}

export default async function CreditsRoute({ params }: { params: Promise<{ locale: string }> }) {
  const l = lang((await params).locale);
  const result = await loadQuranCredits();
  if (result.status === 'off') notFound();
  return <CreditsPage locale={l} quran={result.credits} editionsUnavailable={result.status === 'error'} />;
}
