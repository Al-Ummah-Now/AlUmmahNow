import type { VideoObject } from '@al-ummah/shared-types';
import type { CursorPage } from '@/hooks/useCursorList';
import type { PopulatedChannelSection } from '@/components/ChannelSections/sectionData';
import type { ChannelTab } from './index';

/**
 * A channel tab's first data, read on the server so the page's HTML carries its list (wiki AUN-SEO,
 * phase 4): the Home tab's populated sections, or the first page of the Videos or Shorts tab.
 */
export interface ChannelTabInitial {
  tab: ChannelTab;
  sections?: PopulatedChannelSection[];
  page?: CursorPage<VideoObject>;
}
