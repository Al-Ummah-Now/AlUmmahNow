'use client';

/**
 * The "manage" link at the top of a channel tab, for people who run the
 * channel: Home and Channels open Sections, Videos/Shorts/Live open the video
 * manager, Playlists and Community open theirs, About opens the channel
 * details. Shown only when the viewer's channel role may open that settings
 * page (the same rule the settings pages enforce); visitors see nothing.
 */
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import type { ChannelTab } from './index';
import { useChannelViewer } from '@/components/Channel/ChannelViewerContext';
import { useLanguage } from '@/hooks/useLanguage';
import type { ChannelSettingsPage } from '@/lib/channels/permissions';

const TAB_SETTINGS_PAGE: Record<ChannelTab, ChannelSettingsPage> = {
  home: 'sections',
  channels: 'sections',
  videos: 'videos',
  shorts: 'videos',
  live: 'videos',
  playlists: 'playlists',
  community: 'community',
  about: 'edit',
};

export function TabManageLink({ channelId, tab }: { channelId: string; tab: ChannelTab }) {
  const { t, lang } = useLanguage();
  const { canManage } = useChannelViewer();
  const page = TAB_SETTINGS_PAGE[tab];
  if (!page || !canManage(page)) return null;

  const label: Record<ChannelSettingsPage, string> = {
    sections: t.channel.manageSections,
    videos: t.channel.manageVideos,
    playlists: t.playlist.managePlaylists,
    community: t.channel.manageCommunityPosts,
    edit: t.channel.editChannel,
    overview: t.channel.channelSettings,
    tabs: t.channel.manageSections,
    team: t.channel.channelSettings,
  };

  return (
    <div className="mb-4 flex justify-end">
      <Link
        href={`/${lang}/settings/channel/${channelId}/${page}`}
        data-testid="tab-manage-link"
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-[var(--fanous-color-text-primary)] hover:bg-[color-mix(in_srgb,var(--fanous-color-primary)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-primary)]"
      >
        <Pencil aria-hidden="true" className="h-4 w-4 text-[var(--fanous-color-primary)]" />
        {label[page]}
      </Link>
    </div>
  );
}
