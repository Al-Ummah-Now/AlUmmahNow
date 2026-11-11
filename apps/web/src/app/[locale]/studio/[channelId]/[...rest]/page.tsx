import { notFound, redirect } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { checkPath, legacyHref } from '@/lib/studio/nav';
import { getStudioAccess } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; rest: string[] }>;
}

/**
 * Guards every known Studio path without a Studio page of its own: a section
 * Studio hasn't rebuilt opens its existing channel settings page.
 */
export default async function StudioCatchAllPage({ params }: Props) {
  const { locale, channelId, rest } = await params;
  const access = await getStudioAccess(channelId);
  if (access.status !== 'ok') notFound();

  const result = checkPath(access.role, rest);
  if (result.status === 'unknown') notFound();
  if (result.status === 'redirect') redirect(`/${locale}/studio/${encodeURIComponent(channelId)}/${result.path}`);
  if (result.status === 'forbidden') return <StudioNoAccess locale={locale} channelId={channelId} />;
  const legacy = legacyHref(locale, channelId, rest.join('/'));
  if (!legacy) notFound();
  redirect(legacy);
}
