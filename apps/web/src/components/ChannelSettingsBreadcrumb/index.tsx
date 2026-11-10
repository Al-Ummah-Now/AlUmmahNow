'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { BreadcrumbTrail, type Crumb } from '@/components/settings/SettingsBreadcrumb';
import { channelPath } from '@/lib/channel-url';

export type ChannelSettingsPage = 'overview' | 'edit' | 'videos' | 'tabs' | 'sections' | 'community' | 'communityNew' | 'playlists' | 'team';

interface ChannelSettingsBreadcrumbProps {
  channelId: string;
  /** Empty while loading or where the page does not load the channel: the trail then starts at Settings. */
  channelName?: string;
  /** The channel's handle, for its canonical /@handle link (else /channels/<id>). */
  channelHandle?: string | null;
  locale: string;
  currentPage: ChannelSettingsPage;
  /** A page under `currentPage` (a playlist in Manage Playlists): `currentPage` then links back. */
  subPage?: string;
  className?: string;
}

/**
 * <channel> › Settings › <page>, with a back arrow to the parent page: the
 * channel's settings overview from a sub-page, the channel itself from the
 * overview. Channel settings belong to the channel, not to the user's own
 * Settings (/settings), so the trail never passes through it.
 */
export default function ChannelSettingsBreadcrumb({
  channelId,
  channelName,
  channelHandle,
  locale,
  currentPage,
  subPage,
  className,
}: ChannelSettingsBreadcrumbProps) {
  const { t } = useLanguage();
  const overview = `/${locale}/settings/channel/${channelId}`;

  const pageLabels: Record<Exclude<ChannelSettingsPage, 'overview' | 'communityNew'>, string> = {
    edit: t.channel.editChannel || 'Edit Channel',
    videos: t.video.videoManagement || 'Video Management',
    tabs: t.channel.tabs?.manage_tabs || 'Manage Tabs',
    sections: t.channel.manageSections || 'Manage Sections',
    community: t.channel.communitySettings || 'Community',
    playlists: t.playlist.managePlaylists,
    team: t.channelRoles.team,
  };

  const settingsLabel = t.header?.settings || 'Settings';
  // The channel name opens the channel; while it loads the trail starts at Settings
  const trail: Crumb[] = channelName ? [{ label: channelName, href: channelPath(locale, { id: channelId, handle: channelHandle }) }] : [];
  trail.push({ label: settingsLabel, href: overview });
  if (currentPage === 'communityNew') {
    trail.push({ label: pageLabels.community, href: `${overview}/community` }, { label: t.community.newPost });
  } else if (currentPage !== 'overview' && subPage) {
    trail.push({ label: pageLabels[currentPage], href: `${overview}/${currentPage}` }, { label: subPage });
  } else if (currentPage !== 'overview') {
    trail.push({ label: pageLabels[currentPage] });
  }

  return (
    <BreadcrumbTrail
      trail={trail}
      label={t.channelManage.breadcrumb}
      testId="channel-settings-breadcrumb"
      className={className}
    />
  );
}
