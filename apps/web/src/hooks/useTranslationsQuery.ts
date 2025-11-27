"use client";

/**
 * useTranslationsQuery Hook
 *
 * React Query hook for fetching translations from the API.
 * Provides caching, automatic refetching, and error handling.
 */

import { useQuery } from "@tanstack/react-query";
import { getTranslations as getApiTranslations } from "@/lib/api/i18n";
import { getTranslations as getStaticTranslations } from "@/lib/i18n/utils";
import type { SupportedLanguage } from "@/lib/i18n/types";
import type { AppTranslations } from "@al-ummah/shared-types";

/**
 * Query key factory for translations
 */
export const translationsQueryKeys = {
  all: ["translations"] as const,
  locale: (locale: SupportedLanguage) =>
    [...translationsQueryKeys.all, locale] as const,
};

/**
 * Hook to fetch translations from API with React Query
 *
 * Falls back to static translations if API fails.
 *
 * @param locale - Language code ('en' or 'ar')
 * @returns Query result with translations
 */
export function useTranslationsQuery(locale: SupportedLanguage) {
  return useQuery({
    queryKey: translationsQueryKeys.locale(locale),
    queryFn: async (): Promise<AppTranslations> => {
      const apiData = await getApiTranslations(locale);

      if (apiData && apiData.translations) {
        return apiData.translations;
      }

      // Fallback to static translations if API fails
      console.warn(
        `[useTranslationsQuery] API translations unavailable for ${locale}, using static fallback`
      );
      return getStaticTranslations(locale);
    },
    // Keep translations fresh for 1 hour
    staleTime: 1000 * 60 * 60,
    // Cache translations for 24 hours
    gcTime: 1000 * 60 * 60 * 24,
    // Don't refetch on window focus for translations
    refetchOnWindowFocus: false,
    // Refetch on reconnect to get fresh translations
    refetchOnReconnect: true,
    // Use static translations as initial/placeholder data for instant load
    placeholderData: () => getStaticTranslations(locale),
  });
}

/**
 * Hook to get translations with loading state
 *
 * @param locale - Language code ('en' or 'ar')
 * @returns Object with translations, loading state, and error
 */
export function useApiTranslations(locale: SupportedLanguage) {
  const { data, isLoading, error, isFetching, isStale } =
    useTranslationsQuery(locale);

  // Always return valid translations (data includes placeholder during loading)
  return {
    translations: data || getStaticTranslations(locale),
    isLoading,
    isFetching,
    isStale,
    error,
    // True when using API data (not placeholder)
    isFromApi: !isLoading && data !== undefined && !error,
  };
}
