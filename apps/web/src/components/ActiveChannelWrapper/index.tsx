"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { ActiveChannelProvider } from "@/contexts/ActiveChannelContext";
import type { Channel } from "@al-ummah/shared-types";

interface ActiveChannelWrapperProps {
  children: React.ReactNode;
}

/**
 * Client component wrapper for ActiveChannelProvider.
 *
 * Uses the channels already held in the session (MultiAccountProvider) instead
 * of fetching them: this wrapper is in the root layout, and the previous
 * listChannels({ limit: 100 }) Server Action ran on every page, took ~2s and,
 * because Server Actions run one at a time, delayed every other action on the
 * page (e.g. loading the profile). reloadChannels() keeps the session current
 * after channel changes.
 */
export function ActiveChannelWrapper({ children }: ActiveChannelWrapperProps) {
  const { user } = useAuth();
  const { user: sessionUser } = useMultiAccount();
  const sessionChannels = sessionUser?.channels;

  const channels = useMemo(
    () => (sessionChannels ?? []) as unknown as Channel[],
    [sessionChannels],
  );

  return (
    <ActiveChannelProvider userChannels={channels} userId={user?.id}>
      {children}
    </ActiveChannelProvider>
  );
}
