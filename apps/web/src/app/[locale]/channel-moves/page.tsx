import { notFound } from 'next/navigation';
import MoveOffers from '@/components/ChannelMoves/MoveOffers';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { getFeatures } from '@/lib/features/server';
import { getTranslations } from '@/lib/i18n';

/** My open channel offers (wiki AUN-CHANNEL-CLAIM CC-7); the site's 404 while the channelMove switch is off. */
export default async function ChannelMovesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const m = getTranslations(locale as 'en' | 'ar').channelMoves;
  if (!(await getServerAuthContext())) return <SignInPrompt title={m.offers.title} message={m.offers.description} />;
  if (!(await getFeatures()).channelMove) notFound();
  return <MoveOffers />;
}
