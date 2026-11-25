/**
 * Player test harness (docs/specs/VIDEO-PLAYER.md section 9). Development and the player E2E
 * build only: a production build without NEXT_PUBLIC_PLAYER_HARNESS=1 answers 404. Both values
 * are inlined at build time, so the harness cannot be switched on in a deployed site.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmbedHarness } from './EmbedHarness';
import { PlayerHarness } from './PlayerHarness';

export const metadata: Metadata = { title: 'Player harness', robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlayerHarnessPage({ params, searchParams }: Props) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_PLAYER_HARNESS !== '1') notFound();
  const { locale } = await params;
  const query = await searchParams;
  // ?embed=1: the embed frame's own player, with the embed's parameters (autoplay, gesture)
  if (query.embed === '1') return <EmbedHarness query={{ ...query, lang: locale }} />;
  return (
    <Suspense>
      <PlayerHarness lang={locale === 'ar' ? 'ar' : 'en'} />
    </Suspense>
  );
}
