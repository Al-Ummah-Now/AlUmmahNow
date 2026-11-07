import { SessionManager } from '@/lib/auth/session-manager';
import { getProfileById } from '@/lib/api/profiles';
import { listChannels } from '@/lib/api/channels';
import { logger } from '@/lib/logger-server';
import type { Profile } from '@/interfaces';
import type { Channel } from '@al-ummah/shared-types';
import ProfilePageClient from './ProfilePageClient';

// Per-user page: never cache
export const dynamic = 'force-dynamic';

/**
 * Profile page. The profile and the user's channels are loaded here, in
 * parallel, as part of the page request, so they arrive with the HTML. Loading
 * them from the client meant several Server Actions, which Next.js runs one at
 * a time (and each one a Worker round trip), before anything showed.
 */
export default async function ProfilePage() {
  let initialProfile: Profile | null = null;
  let initialChannels: Channel[] | undefined;

  try {
    const session = await SessionManager.getActiveSession();
    if (session?.userId) {
      const [profileResult, channelsResult] = await Promise.allSettled([
        getProfileById(session.userId),
        listChannels({ limit: 100 }, { channelId: session.userId }),
      ]);
      if (profileResult.status === 'fulfilled') initialProfile = profileResult.value;
      if (channelsResult.status === 'fulfilled' && channelsResult.value?.data) {
        initialChannels = channelsResult.value.data as Channel[];
      }
    }
  } catch (error) {
    // Fall back to client-side loading
    logger.warn('[ProfilePage] Server preload failed', { error });
  }

  return <ProfilePageClient initialProfile={initialProfile} initialChannels={initialChannels} />;
}
