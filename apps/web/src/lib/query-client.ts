/**
 * React Query Configuration
 *
 * Centralized QueryClient setup with optimized defaults for
 * the Al Ummah Now live streaming platform.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Default query options for React Query
 */
const defaultOptions = {
  queries: {
    // Stale time: how long data is considered fresh
    // Live streams: 0ms (always refetch), Others: 5 minutes
    staleTime: 5 * 60 * 1000, // 5 minutes default

    // Cache time: how long unused data stays in cache
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)

    // Retry configuration
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),

    // Refetch configuration
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,

    // Network mode
    networkMode: 'online' as const,
  },
  mutations: {
    // Retry failed mutations
    retry: 1,
    retryDelay: 1000,
    networkMode: 'online' as const,
  },
};

/**
 * Create a new QueryClient instance
 *
 * This should be called once per request on the server
 * and once per app on the client.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions,
  });
}

/**
 * Singleton QueryClient for client-side usage
 *
 * We create a singleton to ensure the same client is used
 * across the entire client-side application.
 */
let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  // Server: always create a new client
  if (typeof window === 'undefined') {
    return createQueryClient();
  }

  // Browser: create client once and reuse
  if (!browserQueryClient) {
    browserQueryClient = createQueryClient();
  }

  return browserQueryClient;
}
