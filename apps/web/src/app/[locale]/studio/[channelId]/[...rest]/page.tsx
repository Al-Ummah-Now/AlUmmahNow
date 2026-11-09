import { notFound, redirect } from 'next/navigation';
import { StudioComingSoon } from '@/components/studio/StudioComingSoon';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { checkPath } from '@/lib/studio/nav';
import { getStudioAccess } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; rest: string[] }>;
}

/** Guards every known Studio path. Each real page replaces its part of this as it's built. */
export default async function StudioCatchAllPage({ params }: Props) {
  const { locale, channelId, rest } = await params;
  const access = await getStudioAccess(channelId);
  if (access.status !== 'ok') notFound();

  const result = checkPath(access.role, rest);
  if (result.status === 'unknown') notFound();
  if (result.status === 'redirect') redirect(`/${locale}/studio/${encodeURIComponent(channelId)}/${result.path}`);
  if (result.status === 'forbidden') return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <StudioComingSoon />;
}
