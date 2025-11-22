"use client";

import { useAuth } from "@/components/AuthProvider/authContext";
import { useChannels } from "@/hooks/useChannels";
import { ActiveChannelProvider } from "@/contexts/ActiveChannelContext";

interface ActiveChannelWrapperProps {
  children: React.ReactNode;
}

/**
 * Client component wrapper for ActiveChannelProvider
 * Fetches user channels and provides them to the context
 */
export function ActiveChannelWrapper({ children }: ActiveChannelWrapperProps) {
  const { user } = useAuth();

  // Fetch user channels
  const { channels } = useChannels({
    channelId: user?.id,
    userId: user?.id,
    autoFetch: !!user?.id
  });

  return (
    <ActiveChannelProvider userChannels={channels} userId={user?.id}>
      {children}
    </ActiveChannelProvider>
  );
}
