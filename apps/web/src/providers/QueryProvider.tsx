"use client";

/**
 * React Query Provider
 *
 * Wraps the application with React Query's QueryClientProvider
 * for data fetching and caching capabilities.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep data fresh for 5 minutes
            staleTime: 1000 * 60 * 5,
            // Cache data for 30 minutes
            gcTime: 1000 * 60 * 30,
            // Don't refetch on window focus by default
            refetchOnWindowFocus: false,
            // Retry failed requests 3 times
            retry: 3,
            // Exponential backoff for retries
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
