'use client';

import { createContext, useContext, type ReactNode } from 'react';

interface ChannelViewer {
  /** The signed-in account can edit this channel's layout (spec CHANNEL-SECTIONS §7) */
  canEditLayout: boolean;
}

const ChannelViewerContext = createContext<ChannelViewer>({ canEditLayout: false });

/**
 * What the channel page shell knows about the viewer, for tab content that
 * renders differently for editors (owner notes, "Edit sections").
 */
export function ChannelViewerProvider({ canEditLayout, children }: ChannelViewer & { children: ReactNode }) {
  return <ChannelViewerContext.Provider value={{ canEditLayout }}>{children}</ChannelViewerContext.Provider>;
}

export function useChannelViewer(): ChannelViewer {
  return useContext(ChannelViewerContext);
}
