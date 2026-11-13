/**
 * Studio → Site (wiki AUN-SCHOLAR-SITES §7.1): the channel's white-label site settings, read on
 * the server for the page and the nav (shown only when the channel has a site). The channel's
 * owner and admins may open it (`channel.edit`); api-videos checks the role again.
 */
import { cache } from 'react';
import type { SiteSettings } from '@al-ummah/shared-types';
import { apiRequestServerResult, buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';

export interface StudioSite {
  site: SiteSettings;
  etag: string;
  primaryHost: string;
  themes: { id: string; version: string; ref: string; name: { en: string; ar: string } }[];
}

/** null: no site (or not allowed). One R2 read per request, shared by the layout and the page. */
export const getStudioSite = cache(async (channelId: string): Promise<StudioSite | null> => {
  const result = await apiRequestServerResult<StudioSite>(
    { method: 'GET', url: buildApiUrl(`/api/sites/channel/${encodeURIComponent(channelId)}`), functionName: 'getStudioSite' },
    getServerAuthContext,
    true,
  );
  return result.status === 200 && result.data?.site ? result.data : null;
});
