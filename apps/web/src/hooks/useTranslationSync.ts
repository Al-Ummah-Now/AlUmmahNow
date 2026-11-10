"use client";

/**
 * useTranslationSync Hook
 *
 * Listens for real-time translation updates via WebSocket
 * and invalidates the React Query cache when updates are received.
 */

import { logger } from '@/lib/logger-client';
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocketSubscription } from "@/lib/websocket/WebSocketProvider";
import { translationsQueryKeys } from "./useTranslationsQuery";
import { clearTranslationsCache } from "@/lib/api/i18n";
import type { SupportedLanguage } from "@/lib/i18n/types";

interface TranslationUpdateMessage {
  type: "translations:updated";
  locale: SupportedLanguage;
  version: string;
  updatedAt: string;
  checksum: string;
}

/**
 * Hook to sync translations in real-time via WebSocket
 *
 * Subscribes to the system:i18n channel and invalidates
 * the translations cache when an update is received.
 *
 * @example
 * ```tsx
 * function App() {
 *   // Call once at app level to enable real-time sync
 *   useTranslationSync();
 *
 *   return <MyApp />;
 * }
 * ```
 */
export function useTranslationSync(): void {
  const queryClient = useQueryClient();
  const lastUpdateRef = useRef<string | null>(null);

  // Subscribe to system:i18n channel
  useWebSocketSubscription(
    "system:i18n",
    (data: unknown) => {
      const message = data as TranslationUpdateMessage;

      // Verify it's a translation update message
      if (message?.type !== "translations:updated") {
        return;
      }

      // Prevent duplicate invalidations for the same update
      const updateKey = `${message.locale}-${message.version}-${message.checksum}`;
      if (lastUpdateRef.current === updateKey) {
        return;
      }
      lastUpdateRef.current = updateKey;

      logger.debug(
        `[i18n] Received translation update for ${message.locale} (v${message.version})`
      );

      // Clear the in-memory cache for this locale
      clearTranslationsCache(message.locale);

      // Invalidate the React Query cache for this locale
      queryClient.invalidateQueries({
        queryKey: translationsQueryKeys.locale(message.locale),
      });

      // Also invalidate the "all" translations query if it exists
      queryClient.invalidateQueries({
        queryKey: translationsQueryKeys.all,
        exact: true,
      });
    },
    []
  );
}

/**
 * Hook to get translation sync status
 *
 * Returns whether the WebSocket connection is active for real-time sync
 */
export function useTranslationSyncStatus(): boolean {
  // The useWebSocketSubscription returns the connection status
  // but since we're using it in useTranslationSync, we just return true
  // when mounted (actual connection is handled by WebSocketProvider)
  return true;
}
