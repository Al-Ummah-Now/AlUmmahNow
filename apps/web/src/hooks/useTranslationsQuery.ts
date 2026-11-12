"use client";

/**
 * useTranslationsQuery Hook
 *
 * React Query hook for fetching translations from the API.
 * Provides caching, automatic refetching, and error handling.
 *
 * Primary source: R2 storage (via API)
 * Fallback: Static translations (key-by-key basis)
 */

import { useQuery } from "@tanstack/react-query";
import { getTranslations as getApiTranslations } from "@/lib/api/i18n";
import { getTranslations as getStaticTranslations } from "@/lib/i18n/utils";
import { logger } from "@/lib/logger-client";
import type { SupportedLanguage } from "@/lib/i18n/types";
import { applyTranslationOverrides } from "@al-ummah/shared-types";
import type { AppTranslations as ApiAppTranslations } from "@al-ummah/shared-types";
// The merged result always starts from the static web translations, so it has
// the full web shape (a superset of the shared/API type)
import type { AppTranslations } from "@/lib/i18n/types";

/**
 * Deep merge translations with key-by-key fallback
 *
 * Merges API translations over static translations.
 * If a key exists in API, use it. Otherwise, fall back to static.
 *
 * @param staticTrans - Static translations (fallback)
 * @param apiTrans - API translations (primary)
 * @returns Merged translations
 */
function deepMergeTranslations(
  staticTrans: AppTranslations,
  apiTrans: ApiAppTranslations | undefined | null
): AppTranslations {
  // If no API translations, return static
  if (!apiTrans) {
    return staticTrans;
  }

  // Helper function to recursively merge objects
  function mergeObjects(
    base: Record<string, unknown>,
    override: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...base };

    for (const key in override) {
      if (Object.prototype.hasOwnProperty.call(override, key)) {
        const overrideValue = override[key];
        const baseValue = base[key];

        if (overrideValue === undefined || overrideValue === null) {
          // Keep base value if override value is undefined/null
          continue;
        }

        if (
          typeof overrideValue === "object" &&
          !Array.isArray(overrideValue) &&
          typeof baseValue === "object" &&
          !Array.isArray(baseValue) &&
          baseValue !== null
        ) {
          // Recursively merge nested objects
          result[key] = mergeObjects(
            baseValue as Record<string, unknown>,
            overrideValue as Record<string, unknown>
          );
        } else {
          // Use override value
          result[key] = overrideValue;
        }
      }
    }

    return result;
  }

  return mergeObjects(
    staticTrans as unknown as Record<string, unknown>,
    apiTrans as unknown as Record<string, unknown>
  ) as unknown as AppTranslations;
}

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
 * Primary source: R2 storage (via API)
 * Fallback: Static translations on key-by-key basis
 *
 * @param locale - Language code ('en' or 'ar')
 * @returns Query result with translations
 */
export function useTranslationsQuery(locale: SupportedLanguage) {
  const staticTranslations = getStaticTranslations(locale);

  return useQuery({
    queryKey: translationsQueryKeys.locale(locale),
    queryFn: async (): Promise<AppTranslations> => {
      logger.debug('Fetching translations from API', { locale });
      const apiData = await getApiTranslations(locale);

      if (apiData && apiData.translations) {
        // #982: with an override list only the keys an admin edited replace
        // this build's static text, so repo copy changes always show. A store
        // without the list (pre-#982) is merged whole, as before.
        const merged = Array.isArray(apiData.overrides)
          ? applyTranslationOverrides(staticTranslations, apiData.translations, apiData.overrides)
          : deepMergeTranslations(staticTranslations, apiData.translations);
        logger.debug('Loaded translations from R2', { locale, appName: merged.common.appName });
        return merged;
      }

      // Full fallback to static translations if API completely fails
      logger.warn('API translations unavailable, using static fallback', { locale });
      return staticTranslations;
    },
    // Data never becomes stale on its own - WebSocket handles invalidation
    // When admin updates translations, WebSocket broadcasts to all clients
    // which triggers cache invalidation via useTranslationSync hook
    staleTime: Infinity,
    // Cache translations for 24 hours (garbage collection)
    gcTime: 1000 * 60 * 60 * 24,
    // Don't refetch on window focus - WebSocket handles real-time updates
    refetchOnWindowFocus: false,
    // Refetch on reconnect to sync any missed updates while offline
    refetchOnReconnect: true,
    // Use static translations as initial/placeholder data for instant load
    placeholderData: staticTranslations,
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
