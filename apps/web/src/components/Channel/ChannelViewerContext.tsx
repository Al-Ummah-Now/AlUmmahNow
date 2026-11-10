'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ChannelRole } from '@al-ummah/shared-types';
import { useOptionalMultiAccount } from '@/hooks/useMultiAccount';
import { canOpenSettingsPage, type ChannelSettingsPage } from '@/lib/channels/permissions';

interface ChannelViewer {
  /** The viewer's role on this channel: owner, a channel role they were given, or none */
  role: ChannelRole | null;
  /** The signed-in account can edit this channel's layout (spec CHANNEL-SECTIONS §7) */
  canEditLayout: boolean;
  /** The viewer may open this channel settings page (same rule as the settings guard) */
  canManage: (page: ChannelSettingsPage) => boolean;
}

const ChannelViewerContext = createContext<ChannelViewer>({ role: null, canEditLayout: false, canManage: () => false });

/**
 * What the channel page shell knows about the viewer, for tab content that
 * renders differently for people who run the channel (manage links, retry on
 * a failed load). The role comes from the account's live channel list (the
 * same list as the account menu); the server enforces every write again.
 */
export function ChannelViewerProvider({ channelId, isOwner, children }: { channelId: string; isOwner: boolean; children: ReactNode }) {
  const user = useOptionalMultiAccount()?.user;
  const role: ChannelRole | null = isOwner ? 'owner' : (user?.channels.find((c) => c.id === channelId)?.role ?? null);
  const value: ChannelViewer = {
    role,
    canEditLayout: canOpenSettingsPage(role, 'sections'),
    canManage: (page) => canOpenSettingsPage(role, page),
  };
  return <ChannelViewerContext.Provider value={value}>{children}</ChannelViewerContext.Provider>;
}

export function useChannelViewer(): ChannelViewer {
  return useContext(ChannelViewerContext);
}
