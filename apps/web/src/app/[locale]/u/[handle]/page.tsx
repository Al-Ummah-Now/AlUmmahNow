import { notFound } from 'next/navigation';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { decodeHandleSegment } from '@/lib/channel-loaders';
import { getCurrentUserId } from '@/lib/channel-utils';
import { loadPublicProfile } from '@/lib/public-profile-loaders';
import { getPublicUserPlaylists, getPublicUserSubscriptions } from '@/lib/api/public-profile';
import { PublicProfileView } from '@/components/publicProfile/PublicProfileView';

interface PublicProfilePageProps {
  params: Promise<{ locale: string; handle: string }>;
}

/**
 * Public profile (Story 29.5): /{locale}/u/@{handle} (middleware rewrite to this route). No
 * public profile (unknown handle, no handle any more, removed or banned) is a real 404. Reached only
 * from the user's comments, and never indexed (layout metadata; owner decisions 2026-11-14).
 */
export default async function PublicProfilePage({ params }: PublicProfilePageProps) {
  const { locale, handle } = await params;
  if (!isLocaleSupported(locale)) notFound();
  const requested = decodeHandleSegment(handle);
  const profile = await loadPublicProfile(requested, locale);
  if (!profile) notFound();

  const [subscriptions, playlists, viewerId] = await Promise.all([
    profile.sections.subscriptions ? getPublicUserSubscriptions(profile.handle, 1) : Promise.resolve(null),
    profile.sections.playlists ? getPublicUserPlaylists(profile.handle) : Promise.resolve(null),
    getCurrentUserId(),
  ]);

  return (
    <PublicProfileView
      profile={profile}
      locale={locale}
      isOwner={!!viewerId && viewerId === profile.id}
      initial={{ subscriptions, playlists }}
    />
  );
}
