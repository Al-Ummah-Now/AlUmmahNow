import type { VideoObject } from '@al-ummah/shared-types';
import type { CursorPage } from '@/hooks/useCursorList';
import type { ChannelHomeFallback, PopulatedChannelSection } from '@/components/ChannelSections/sectionData';
import type { ChannelTab } from './index';

/**
 * A channel tab's first data, read on the server so the page's HTML carries its list (wiki AUN-SEO,
 * phase 4): the Home tab's populated sections (and its uploads when no section has content, #1206), or
 * the first page of the Videos or Shorts tab. Images are stable (lib/ssr/stable-images.ts); `partial`
 * when one only the viewer may see was dropped, so the tab reloads after hydration.
 */
export interface ChannelTabInitial {
  tab: ChannelTab;
  sections?: PopulatedChannelSection[];
  fallback?: ChannelHomeFallback;
  page?: CursorPage<VideoObject>;
  partial?: boolean;
}
