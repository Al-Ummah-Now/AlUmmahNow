/**
 * QueryProvider Component
 *
 * Client-side wrapper for React Query's QueryClientProvider.
 * Provides React Query context to all child components.
 */

'use client';

import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';

interface QueryProviderProps {
  children: React.ReactNode;
}

/**
 * QueryProvider component that wraps the app with React Query
 *
 * This component is marked as 'use client' since QueryClientProvider
 * requires client-side context.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  // Get or create the QueryClient instance
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
