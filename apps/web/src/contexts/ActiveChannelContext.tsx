'use client';
import { logger } from '@/lib/logger-client';

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Channel } from "@al-ummah/shared-types";

interface ActiveChannel {
  channelId: string;
  userId: string;
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

const STORAGE_KEY_PREFIX = 'al-ummah-active-channel';

// Helper to get user-specific storage key
const getStorageKey = (userId: string | undefined) => {
  if (!userId) return STORAGE_KEY_PREFIX;
  return `${STORAGE_KEY_PREFIX}-${userId}`;
};

export interface ActiveChannelProviderProps {
  children: React.ReactNode;
  userChannels?: Channel[];
  userId?: string;
  /**
   * The session's active channel (chosen in the account menu, which may be a
   * channel the user manages rather than owns). When it is in the list it
   * wins over the stored choice, so every page acts as the same channel.
   */
  sessionChannelId?: string | null;
}

export const ActiveChannelProvider: React.FC<ActiveChannelProviderProps> = ({
  children,
  userChannels = [],
  userId,
  sessionChannelId,
}) => {
  const [activeChannel, setActiveChannelState] = useState<ActiveChannel | null>(null);

  // Initialize active channel from localStorage or default to main/first channel
  useEffect(() => {
    logger.debug('ActiveChannelProvider: Initializing with channels:', userChannels);
    logger.debug('ActiveChannelProvider: userId:', userId);

    // Clear active channel if no user
    if (!userId) {
      logger.debug('ActiveChannelProvider: No userId, clearing active channel');
      setActiveChannelState(null);
      if (typeof window !== 'undefined') {
        // Clear any stored channel for this session
        localStorage.removeItem(STORAGE_KEY_PREFIX);
      }
      return;
    }

    // Clear active channel if no channels available (user has no profile/channels)
    if (!userChannels || userChannels.length === 0) {
      logger.debug('ActiveChannelProvider: No channels available, clearing active channel');
      setActiveChannelState(null);
      const storageKey = getStorageKey(userId);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
      return;
    }

    const storageKey = getStorageKey(userId);

    const sessionChannel = sessionChannelId ? userChannels.find(ch => ch.id === sessionChannelId) : undefined;
    if (sessionChannel) {
      const fromSession: ActiveChannel = {
        channelId: sessionChannel.id,
        userId: sessionChannel.userId,
        name: sessionChannel.name,
        avatarUrl: sessionChannel.avatarUrl,
        isMain: sessionChannel.isMain,
      };
      setActiveChannelState(fromSession);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem(storageKey, JSON.stringify(fromSession)); } catch { /* storage unavailable */ }
      }
      return;
    }

    // Try to load from localStorage for THIS user
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as ActiveChannel;

          // Validate that the stored channel still exists in user's channels
          const channelExists = userChannels.some(ch => ch.id === parsed.channelId);

          if (channelExists) {
            logger.debug('ActiveChannelProvider: Restored from localStorage:', parsed);
            setActiveChannelState(parsed);
            return;
          } else {
            logger.debug('ActiveChannelProvider: Stored channel no longer exists, clearing');
            localStorage.removeItem(storageKey);
          }
        }
      } catch (error) {
        logger.error('ActiveChannelProvider: Error loading from localStorage:', error);
        localStorage.removeItem(storageKey);
      }
    }

    // Default to main channel or first channel
    // IMPORTANT: Only set default channel if channels belong to current user
    const mainChannel = userChannels.find(ch => ch.isMain && ch.userId === userId);
    const defaultChannel = mainChannel || userChannels.find(ch => ch.userId === userId);

    if (defaultChannel) {
      const activeChannelData: ActiveChannel = {
        channelId: defaultChannel.id,
        userId: defaultChannel.userId,
        name: defaultChannel.name,
        avatarUrl: defaultChannel.avatarUrl,
        isMain: defaultChannel.isMain,
      };

      logger.debug('ActiveChannelProvider: Setting default channel:', activeChannelData);
      setActiveChannelState(activeChannelData);

      // Save to localStorage with user-specific key
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(activeChannelData));
      }
    } else {
      // No channels for this user - clear active channel
      logger.debug('ActiveChannelProvider: No channels for user, clearing active channel');
      setActiveChannelState(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey);
      }
    }
  }, [userChannels, userId, sessionChannelId]);

  const setActiveChannel = useCallback((channel: ActiveChannel) => {
    logger.debug('ActiveChannelProvider: Setting active channel:', channel);
    setActiveChannelState(channel);

    // Persist to localStorage with user-specific key
    if (typeof window !== 'undefined' && userId) {
      const storageKey = getStorageKey(userId);
      localStorage.setItem(storageKey, JSON.stringify(channel));
    }
  }, [userId]);

  const clearActiveChannel = useCallback(() => {
    logger.debug('ActiveChannelProvider: Clearing active channel');
    setActiveChannelState(null);

    // Remove from localStorage
    if (typeof window !== 'undefined' && userId) {
      const storageKey = getStorageKey(userId);
      localStorage.removeItem(storageKey);
    }
  }, [userId]);

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
