import { notFound } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { SocialStudio } from '@/components/studio/social/SocialStudio';
import { requireStudioPage } from '@/lib/studio/server';
import { getSocialOverview } from '@/lib/studio/social';

const OUTCOME = /^[a-z_]{1,40}$/;

/** Studio → Social (wiki AUN-SOCIAL, SOC-1): connected accounts, post text, recent posts, feeds and webhooks. */
export default async function StudioSocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; channelId: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { locale, channelId } = await params;
  const query = await searchParams;
  const access = await requireStudioPage(channelId, ['social']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const overview = await getSocialOverview(channelId);
  if (!overview) notFound();
  const outcome = {
    ...(query.connected && OUTCOME.test(query.connected) ? { connected: query.connected } : {}),
    ...(query.error && OUTCOME.test(query.error) ? { error: query.error } : {}),
  };
  return <SocialStudio channelId={channelId} locale={locale === 'ar' ? 'ar' : 'en'} initial={overview} outcome={outcome} />;
}
