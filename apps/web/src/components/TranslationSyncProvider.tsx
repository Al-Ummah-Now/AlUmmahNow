"use client";

/**
 * TranslationSyncProvider
 *
 * Client component that enables real-time translation sync via WebSocket.
 * Place this component inside the WebSocketProvider to enable auto-sync.
 */

import { useTranslationSync } from "@/hooks/useTranslationSync";

interface TranslationSyncProviderProps {
  children: React.ReactNode;
}

export function TranslationSyncProvider({ children }: TranslationSyncProviderProps) {
  // Enable real-time translation sync
  useTranslationSync();

  return <>{children}</>;
}
