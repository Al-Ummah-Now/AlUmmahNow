/**
 * i18n API Client
 *
 * Provides methods for fetching translations and i18n configuration from the API.
 */

import { getApiUrl } from "@/lib/runtime-config";
import {
  TranslationData,
  I18nConfig,
  I18nMetadata,
  SupportedLanguage,
} from "@al-ummah/shared-types";

const baseUrl = getApiUrl();

// Cache for translations to avoid redundant fetches
const translationsCache = new Map<string, { data: TranslationData; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export interface TranslationsResponse {
  success: boolean;
  result: TranslationData;
}

export interface I18nConfigResponse {
  success: boolean;
  result: I18nConfig;
}

export interface I18nMetadataResponse {
  success: boolean;
  result: I18nMetadata;
}

/**
 * Fetch translations for a specific locale
 */
export async function getTranslations(
  locale: SupportedLanguage
): Promise<TranslationData | null> {
  // Check in-memory cache first
  const cached = translationsCache.get(locale);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`${baseUrl}/api/i18n/translations/${locale}`, {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 3600, // Next.js cache revalidation (1 hour)
      },
    });

    if (!response.ok) {
      console.error(
        `[i18n API] Failed to fetch translations for ${locale}: ${response.status}`
      );
      return null;
    }

    const data: TranslationsResponse = await response.json();

    if (data.success && data.result) {
      // Update in-memory cache
      translationsCache.set(locale, {
        data: data.result,
        timestamp: Date.now(),
      });
      return data.result;
    }

    return null;
  } catch (error) {
    console.error(`[i18n API] Error fetching translations for ${locale}:`, error);
    return null;
  }
}

/**
 * Fetch i18n configuration
 */
export async function getI18nConfig(): Promise<I18nConfig | null> {
  try {
    const response = await fetch(`${baseUrl}/api/i18n/config`, {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 3600, // Next.js cache revalidation (1 hour)
      },
    });

    if (!response.ok) {
      console.error(`[i18n API] Failed to fetch i18n config: ${response.status}`);
      return null;
    }

    const data: I18nConfigResponse = await response.json();

    if (data.success && data.result) {
      return data.result;
    }

    return null;
  } catch (error) {
    console.error("[i18n API] Error fetching i18n config:", error);
    return null;
  }
}

/**
 * Fetch i18n metadata (for cache invalidation)
 */
export async function getI18nMetadata(): Promise<I18nMetadata | null> {
  try {
    const response = await fetch(`${baseUrl}/api/i18n/metadata`, {
      headers: {
        Accept: "application/json",
      },
      // Short cache for metadata (5 minutes)
      next: {
        revalidate: 300,
      },
    });

    if (!response.ok) {
      console.error(`[i18n API] Failed to fetch i18n metadata: ${response.status}`);
      return null;
    }

    const data: I18nMetadataResponse = await response.json();

    if (data.success && data.result) {
      return data.result;
    }

    return null;
  } catch (error) {
    console.error("[i18n API] Error fetching i18n metadata:", error);
    return null;
  }
}

/**
 * Check if local translations need update
 */
export async function shouldUpdateTranslations(
  locale: SupportedLanguage,
  currentChecksum?: string
): Promise<boolean> {
  if (!currentChecksum) return true;

  const metadata = await getI18nMetadata();
  if (!metadata) return true;

  const serverChecksum = metadata.checksums[locale];
  return serverChecksum !== currentChecksum;
}

/**
 * Clear translations cache for a specific locale or all locales
 */
export function clearTranslationsCache(locale?: SupportedLanguage): void {
  if (locale) {
    translationsCache.delete(locale);
  } else {
    translationsCache.clear();
  }
}

/**
 * Get cached translations without fetching
 */
export function getCachedTranslations(
  locale: SupportedLanguage
): TranslationData | null {
  const cached = translationsCache.get(locale);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}
