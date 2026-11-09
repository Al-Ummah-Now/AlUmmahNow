/**
 * Player test harness (docs/specs/VIDEO-PLAYER.md section 9). Development and the player E2E
 * build only: a production build without NEXT_PUBLIC_PLAYER_HARNESS=1 answers 404. Both values
 * are inlined at build time, so the harness cannot be switched on in a deployed site.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlayerHarness } from './PlayerHarness';

export const metadata: Metadata = { title: 'Player harness', robots: { index: false, follow: false } };

export default async function PlayerHarnessPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_PLAYER_HARNESS !== '1') notFound();
  const { locale } = await params;
  return (
    <Suspense>
      <PlayerHarness lang={locale === 'ar' ? 'ar' : 'en'} />
    </Suspense>
  );
}
