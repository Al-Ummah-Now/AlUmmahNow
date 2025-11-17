/**
 * React hook for working with localized content
 *
 * This hook provides utilities for displaying and managing
 * multi-language content in the UI
 */

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  LocalizationHelper,
  LocalizableEntity,
  SupportedLanguage,
  LocalizedContent
} from '@al-ummah/shared-types';

/**
 * Get the current language from the URL path
 */
export function useCurrentLanguage(): SupportedLanguage {
  const pathname = usePathname();

  // Extract language from path (e.g., /en/... or /ar/...)
  const pathLang = pathname.split('/')[1] as SupportedLanguage;

  // Validate and return
  if (pathLang === 'ar') return 'ar';
  return 'en'; // Default to English
}

/**
 * Hook for transforming an entity with localized content
 *
 * @param entity - The entity with localized fields
 * @param fields - Array of field names that support localization
 * @returns The entity with appropriate language content
 *
 * @example
 * const video = useLocalizedContent(rawVideo, ['title', 'description']);
 * // video.title and video.description will have the correct language
 */
export function useLocalizedContent<T extends LocalizableEntity>(
  entity: T | null | undefined,
  fields: (keyof T)[]
): T | null | undefined {
  const lang = useCurrentLanguage();

  return useMemo(() => {
    if (!entity) return entity;

    return LocalizationHelper.transformForResponse(
      entity,
      lang,
      fields
    );
  }, [entity, lang, fields]);
}

/**
 * Hook for managing a single localized field
 *
 * @param localized - The localized content object
 * @param fallback - Legacy field value
 * @param defaultLang - Default language of the entity
 * @returns The appropriate language value
 *
 * @example
 * const title = useLocalizedField(video.titleLocalized, video.title);
 */
export function useLocalizedField(
  localized: LocalizedContent | undefined,
  fallback: string | undefined | null,
  defaultLang?: SupportedLanguage
): string | undefined {
  const lang = useCurrentLanguage();

  return useMemo(() => {
    return LocalizationHelper.getValue(
      localized,
      fallback,
      lang,
      defaultLang
    );
  }, [localized, fallback, lang, defaultLang]);
}

/**
 * Hook for getting all available languages for an entity
 *
 * @param entity - The entity to check
 * @param fields - Array of field names that support localization
 * @returns Array of available languages
 *
 * @example
 * const languages = useAvailableLanguages(video, ['title', 'description']);
 * // Returns ['en', 'ar'] if both languages have content
 */
export function useAvailableLanguages<T extends Record<string, any>>(
  entity: T | null | undefined,
  fields: (keyof T)[]
): SupportedLanguage[] {
  return useMemo(() => {
    if (!entity) return [];

    return LocalizationHelper.getAvailableLanguages(entity, fields);
  }, [entity, fields]);
}

/**
 * Hook for getting translation completeness
 *
 * @param entity - The entity to analyze
 * @param fields - Array of field names that support localization
 * @returns Completeness percentage per language
 *
 * @example
 * const completeness = useTranslationCompleteness(video, ['title', 'description']);
 * // Returns { en: 100, ar: 50 } if English is complete and Arabic is half done
 */
export function useTranslationCompleteness<T extends Record<string, any>>(
  entity: T | null | undefined,
  fields: (keyof T)[]
): Record<SupportedLanguage, number> {
  return useMemo(() => {
    if (!entity) return { en: 0, ar: 0 };

    return LocalizationHelper.getTranslationCompleteness(entity, fields);
  }, [entity, fields]);
}

/**
 * Hook for preparing an entity for editing (includes all languages)
 *
 * @param entity - The entity to prepare
 * @param fields - Array of field names that support localization
 * @returns Entity with all localized fields populated
 *
 * @example
 * const editableVideo = usePrepareForEdit(video, ['title', 'description']);
 * // Ensures titleLocalized and descriptionLocalized are populated
 */
export function usePrepareForEdit<T extends LocalizableEntity>(
  entity: T | null | undefined,
  fields: (keyof T)[]
): T | null | undefined {
  return useMemo(() => {
    if (!entity) return entity;

    return LocalizationHelper.prepareForEdit(entity, fields);
  }, [entity, fields]);
}

/**
 * Hook for detecting the language of text
 *
 * @param text - Text to analyze
 * @returns Detected language
 *
 * @example
 * const detectedLang = useDetectLanguage(userInput);
 * // Returns 'ar' if Arabic text, 'en' otherwise
 */
export function useDetectLanguage(text: string | undefined | null): SupportedLanguage {
  return useMemo(() => {
    if (!text) return 'en';

    return LocalizationHelper.detectLanguage(text);
  }, [text]);
}

/**
 * Hook configuration for language preference
 */
interface UseLanguagePreferenceOptions {
  /**
   * Whether to persist the preference
   */
  persist?: boolean;

  /**
   * Storage key for persistence
   */
  storageKey?: string;
}

/**
 * Hook for managing user's language preference
 *
 * @param options - Configuration options
 * @returns Current language and setter
 *
 * @example
 * const [lang, setLang] = useLanguagePreference({ persist: true });
 */
export function useLanguagePreference(
  options: UseLanguagePreferenceOptions = {}
): [SupportedLanguage, (lang: SupportedLanguage) => void] {
  const {
    persist = true,
    storageKey = 'al-ummah-language-preference'
  } = options;

  const currentLang = useCurrentLanguage();

  const setLanguage = (lang: SupportedLanguage) => {
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, lang);
    }

    // Navigate to the new language path
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const newPath = pathname.replace(/^\/(en|ar)/, `/${lang}`);
      window.location.href = newPath;
    }
  };

  return [currentLang, setLanguage];
}

/**
 * Type-safe hook for specific entity types
 */

/**
 * Hook specifically for videos with localization
 */
export function useLocalizedVideo(
  video: any | null | undefined
): any | null | undefined {
  return useLocalizedContent(video, ['title', 'description']);
}

/**
 * Hook specifically for channels with localization
 */
export function useLocalizedChannel(
  channel: any | null | undefined
): any | null | undefined {
  return useLocalizedContent(channel, ['name', 'description']);
}

/**
 * Hook specifically for profiles with localization
 */
export function useLocalizedProfile(
  profile: any | null | undefined
): any | null | undefined {
  return useLocalizedContent(profile, ['displayName', 'firstName', 'lastName', 'bio']);
}

/**
 * Hook for checking if content needs translation
 *
 * @param entity - The entity to check
 * @param fields - Array of field names that support localization
 * @param targetLang - Language to check for
 * @returns Whether translation is needed
 */
export function useNeedsTranslation<T extends Record<string, any>>(
  entity: T | null | undefined,
  fields: (keyof T)[],
  targetLang?: SupportedLanguage
): boolean {
  const lang = targetLang || useCurrentLanguage();

  return useMemo(() => {
    if (!entity) return false;

    for (const field of fields) {
      const fieldName = field as string;
      const localizedField = `${fieldName}Localized`;

      // Check if localized version exists for target language
      if (!entity[localizedField]?.[lang] && entity[fieldName]) {
        return true; // Needs translation
      }
    }

    return false;
  }, [entity, fields, lang]);
}