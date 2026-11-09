'use client';

/**
 * Chrome of every channel settings page: the public channel header (banner,
 * avatar, name, @handle, stats) and the settings tabs, so the owner always
 * sees the channel they are changing. The Customize page renders its own,
 * editable header (see /settings/channel/[id]/edit).
 */

import React from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import type { Channel } from '@al-ummah/shared-types';
import { ChannelHeader } from '@/components/Channel/ChannelHeader';
import { SettingsTabNav, type SettingsTabItem } from '@/components/settings/SettingsTabNav';
import { useLanguage } from '@/hooks/useLanguage';

export type ChannelSettingsSection = 'overview' | 'edit' | 'videos' | 'playlists' | 'tabs' | 'sections' | 'community';

export function useChannelSettingsTabs(channelId: string): SettingsTabItem[] {
  const { t, lang } = useLanguage();
  const base = `/${lang}/settings/channel/${channelId}`;
  return [
    { key: 'overview', label: t.inlineEdit.overview, href: base },
    { key: 'edit', label: t.inlineEdit.customize, href: `${base}/edit` },
    { key: 'videos', label: t.channel.videos, href: `${base}/videos` },
    { key: 'playlists', label: t.channel.playlists, href: `${base}/playlists` },
    { key: 'tabs', label: t.inlineEdit.tabs, href: `${base}/tabs` },
    { key: 'sections', label: t.inlineEdit.sections, href: `${base}/sections` },
    { key: 'community', label: t.channel.community, href: `${base}/community` },
  ];
}

export function ChannelSettingsTabs({ channelId, current }: { channelId: string; current: ChannelSettingsSection }) {
  return <SettingsTabNav items={useChannelSettingsTabs(channelId)} current={current} testId="channel-settings-nav" />;
}

interface ChannelSettingsShellProps {
  channel: Channel | null;
  locale: string;
  children: React.ReactNode;
}

export function ChannelSettingsShell({ channel, locale, children }: ChannelSettingsShellProps) {
  const segments = useSelectedLayoutSegments();
  const section = (segments[0] || 'overview') as ChannelSettingsSection;

  // Customize renders the editable header itself; a missing channel falls back to the page
  if (section === 'edit' || !channel) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950" data-testid="channel-settings-shell">
      <ChannelHeader channel={channel} locale={locale} settings />
      <ChannelSettingsTabs channelId={channel.id} current={section} />
      {children}
    </div>
  );
}

export default ChannelSettingsShell;
