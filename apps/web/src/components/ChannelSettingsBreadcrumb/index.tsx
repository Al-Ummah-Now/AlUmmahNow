'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { BreadcrumbTrail, type Crumb } from '@/components/settings/SettingsBreadcrumb';

export type ChannelSettingsPage = 'overview' | 'edit' | 'videos' | 'tabs' | 'sections' | 'community' | 'communityNew' | 'playlists' | 'team';

interface ChannelSettingsBreadcrumbProps {
  channelId: string;
  /** Empty while loading or where the page does not load the channel: the trail then ends at Channel Settings. */
  channelName?: string;
  locale: string;
  currentPage: ChannelSettingsPage;
  /** A page under `currentPage` (a playlist in Manage Playlists): `currentPage` then links back. */
  subPage?: string;
  className?: string;
}

/**
 * Settings › Channel Settings › <channel> › <page>, with a back arrow to the
 * parent page (the channel's settings overview, or Settings from the overview).
 */
export default function ChannelSettingsBreadcrumb({
  channelId,
  channelName,
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

  const trail: Crumb[] = [{ label: t.header?.settings || 'Settings', href: `/${locale}/settings` }];
  if (channelName) {
    trail.push({ label: t.channel.channelSettings }, { label: channelName, href: overview });
  } else {
    trail.push({ label: t.channel.channelSettings, href: overview });
  }
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
