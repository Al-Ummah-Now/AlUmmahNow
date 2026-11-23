import { notFound, redirect } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { checkPath } from '@/lib/studio/nav';
import { getStudioAccess, getStudioFeatures } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; rest: string[] }>;
}

/**
 * Guards Studio paths without a page of their own: section roots that open
 * their first tab, pages a role can't use, and anything else (404).
 */
export default async function StudioCatchAllPage({ params }: Props) {
  const { locale, channelId, rest } = await params;
  const access = await getStudioAccess(channelId);
  if (access.status !== 'ok') notFound();

  const result = checkPath(access.role, rest, await getStudioFeatures(channelId, access.role));
  if (result.status === 'unknown') notFound();
  if (result.status === 'redirect') redirect(`/${locale}/studio/${encodeURIComponent(channelId)}/${result.path}`);
  if (result.status === 'forbidden') return <StudioNoAccess locale={locale} channelId={channelId} />;
  notFound();
}
