/**
 * Studio → Social (wiki AUN-SOCIAL, SOC-1): the channel's connected accounts, post text, recent posts, webhooks
 * and feeds, read on the server for the page. The channel's owner and admins may open it (`channel.edit`);
 * api-videos checks the role again.
 */
import { cache } from 'react';
import type {
  SocialAccountView,
  SocialDeliveryView,
  SocialFeedKind,
  SocialLanguage,
  SocialNetwork,
  SocialTemplate,
  SocialWebhookView,
} from '@al-ummah/shared-types';
import { apiRequestServerResult, buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';

export interface SocialOverview {
  accounts: SocialAccountView[];
  templates: SocialTemplate[];
  deliveries: SocialDeliveryView[];
  webhooks: SocialWebhookView[];
  networks: Record<SocialNetwork, { available: boolean; configured: boolean }>;
  feeds: Record<SocialFeedKind, Record<SocialLanguage, string>>;
  limits: { webhooks: number };
}

export interface ShareKit {
  videoId: string;
  available: boolean;
  reason?: 'not_public';
  kind?: 'video' | 'short';
  title?: Record<SocialLanguage, string>;
  captions?: Record<SocialLanguage, string>;
  links?: Record<SocialLanguage, string>;
  canonicalLinks?: Record<SocialLanguage, string>;
  thumbnail?: { url?: string; downloadPath: string };
  clip?: { videoId: string; title: string; downloadPath: string; width: number | null; height: number | null; durationSeconds: number | null } | null;
}

/** null: not allowed or unavailable. */
export const getSocialOverview = cache(async (channelId: string): Promise<SocialOverview | null> => {
  const result = await apiRequestServerResult<SocialOverview>(
    { method: 'GET', url: buildApiUrl(`/api/social/channel/${encodeURIComponent(channelId)}`), functionName: 'getSocialOverview' },
    getServerAuthContext,
    true,
  );
  return result.status === 200 && result.data?.accounts ? result.data : null;
});
