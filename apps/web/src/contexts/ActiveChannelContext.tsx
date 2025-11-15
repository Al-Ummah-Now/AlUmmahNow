"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Channel } from "@al-ummah/shared-types";

interface ActiveChannel {
  channelId: string;
  name: string;
  avatarUrl?: string;
  isMain: boolean;
}

interface ActiveChannelContextType {
  activeChannel: ActiveChannel | null;
  setActiveChannel: (channel: ActiveChannel) => void;
  clearActiveChannel: () => void;
  isOwnChannel: (channelId: string) => boolean;
}

const ActiveChannelContext = createContext<ActiveChannelContextType | undefined>(undefined);

const STORAGE_KEY = 'al-ummah-active-channel';

export interface ActiveChannelProviderProps {
  children: React.ReactNode;
  userChannels?: Channel[];
  userId?: string;
}

export const ActiveChannelProvider: React.FC<ActiveChannelProviderProps> = ({
  children,
  userChannels = [],
  userId
}) => {
  const [activeChannel, setActiveChannelState] = useState<ActiveChannel | null>(null);

  // Initialize active channel from localStorage or default to main/first channel
  useEffect(() => {
    console.log('ActiveChannelProvider: Initializing with channels:', userChannels);

    // Clear active channel if no user
    if (!userId) {
      console.log('ActiveChannelProvider: No userId, clearing active channel');
      setActiveChannelState(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }

    // No channels available yet
    if (!userChannels || userChannels.length === 0) {
      console.log('ActiveChannelProvider: No channels available');
      return;
    }

    // Try to load from localStorage
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as ActiveChannel;

          // Validate that the stored channel still exists in user's channels
          const channelExists = userChannels.some(ch => ch.id === parsed.channelId);

          if (channelExists) {
            console.log('ActiveChannelProvider: Restored from localStorage:', parsed);
            setActiveChannelState(parsed);
            return;
          } else {
            console.log('ActiveChannelProvider: Stored channel no longer exists, clearing');
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (error) {
        console.error('ActiveChannelProvider: Error loading from localStorage:', error);
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // Default to main channel or first channel
    const mainChannel = userChannels.find(ch => ch.isMain);
    const defaultChannel = mainChannel || userChannels[0];

    if (defaultChannel) {
      const activeChannelData: ActiveChannel = {
        channelId: defaultChannel.id,
        name: defaultChannel.name,
        avatarUrl: defaultChannel.avatarUrl,
        isMain: defaultChannel.isMain,
      };

      console.log('ActiveChannelProvider: Setting default channel:', activeChannelData);
      setActiveChannelState(activeChannelData);

      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activeChannelData));
      }
    }
  }, [userChannels, userId]);

  const setActiveChannel = useCallback((channel: ActiveChannel) => {
    console.log('ActiveChannelProvider: Setting active channel:', channel);
    setActiveChannelState(channel);

    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(channel));
    }
  }, []);

  const clearActiveChannel = useCallback(() => {
    console.log('ActiveChannelProvider: Clearing active channel');
    setActiveChannelState(null);

    // Remove from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const isOwnChannel = useCallback((channelId: string): boolean => {
    return userChannels.some(ch => ch.id === channelId);
  }, [userChannels]);

  const value: ActiveChannelContextType = {
    activeChannel,
    setActiveChannel,
    clearActiveChannel,
    isOwnChannel,
  };

  return (
    <ActiveChannelContext.Provider value={value}>
      {children}
    </ActiveChannelContext.Provider>
  );
};

export const useActiveChannel = () => {
  const context = useContext(ActiveChannelContext);
  if (!context) {
    throw new Error("useActiveChannel must be used within an ActiveChannelProvider");
  }
  return context;
};
