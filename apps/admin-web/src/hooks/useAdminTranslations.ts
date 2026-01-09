'use client';

/**
 * useAdminTranslations Hook
 *
 * React Query hook for managing translations in admin dashboard.
 * Provides fetching and mutation capabilities for translation editing.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTranslations,
  getI18nMetadata,
  updateTranslations,
} from '@/lib/api/i18n';
import type { SupportedLanguage, AppTranslations } from '@al-ummah/shared-types';

/**
 * Query key factory for admin translations
 */
export const adminTranslationsKeys = {
  all: ['admin-translations'] as const,
  locale: (locale: SupportedLanguage) =>
    [...adminTranslationsKeys.all, locale] as const,
  metadata: ['admin-translations-metadata'] as const,
};

/**
 * Hook to fetch translations for editing
 */
export function useAdminTranslationsQuery(locale: SupportedLanguage) {
  return useQuery({
    queryKey: adminTranslationsKeys.locale(locale),
    queryFn: async () => {
      const data = await getTranslations(locale);
      if (!data || !data.translations) {
        throw new Error(`Failed to fetch translations for ${locale}`);
      }
      return data.translations;
    },
    // Don't cache as long for admin - we want fresh data
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to fetch i18n metadata
 */
export function useI18nMetadataQuery() {
  return useQuery({
    queryKey: adminTranslationsKeys.metadata,
    queryFn: async () => {
      const metadata = await getI18nMetadata();
      if (!metadata) {
        throw new Error('Failed to fetch i18n metadata');
      }
      return metadata;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook for updating translations
 */
export function useUpdateTranslationsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      locale,
      translations,
      mode = 'merge',
    }: {
      locale: SupportedLanguage;
      translations: Partial<AppTranslations>;
      mode?: 'merge' | 'replace';
    }) => {
      const result = await updateTranslations(locale, translations, mode);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update translations');
      }
      return result;
    },
    onSuccess: (_, variables) => {
      // Invalidate the translations query for the updated locale
      queryClient.invalidateQueries({
        queryKey: adminTranslationsKeys.locale(variables.locale),
      });
      // Also invalidate metadata as checksums will change
      queryClient.invalidateQueries({
        queryKey: adminTranslationsKeys.metadata,
      });
    },
  });
}

/**
 * Combined hook for admin translation management
 *
 * @param locale - Language code to manage
 * @returns Translations data, loading states, and update function
 */
export function useAdminTranslations(locale: SupportedLanguage) {
  const translationsQuery = useAdminTranslationsQuery(locale);
  const metadataQuery = useI18nMetadataQuery();
  const updateMutation = useUpdateTranslationsMutation();

  return {
    // Translations data
    translations: translationsQuery.data,
    metadata: metadataQuery.data,

    // Loading states
    isLoading: translationsQuery.isLoading || metadataQuery.isLoading,
    isError: translationsQuery.isError || metadataQuery.isError,
    error: translationsQuery.error || metadataQuery.error,

    // Fetching states
    isFetching: translationsQuery.isFetching,
    isRefetching: translationsQuery.isRefetching,

    // Mutation states
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,

    // Actions
    updateTranslations: (
      translations: Partial<AppTranslations>,
      mode?: 'merge' | 'replace'
    ) => updateMutation.mutateAsync({ locale, translations, mode }),

    refetch: translationsQuery.refetch,
  };
}

/**
 * Hook for editing a single translation key
 */
export function useTranslationEditor(locale: SupportedLanguage) {
  const { translations, updateTranslations, isUpdating, updateError } =
    useAdminTranslations(locale);

  /**
   * Update a specific translation key
   *
   * @param section - The section name (e.g., 'common', 'header')
   * @param key - The key within the section
   * @param value - The new value
   */
  const updateKey = async (
    section: keyof AppTranslations,
    key: string,
    value: string
  ) => {
    const updates = {
      [section]: {
        [key]: value,
      },
    } as Partial<AppTranslations>;

    return updateTranslations(updates, 'merge');
  };

  /**
   * Update multiple keys in a section
   */
  const updateSection = async (
    section: keyof AppTranslations,
    values: Record<string, string>
  ) => {
    const updates = {
      [section]: values,
    } as Partial<AppTranslations>;

    return updateTranslations(updates, 'merge');
  };

  return {
    translations,
    isUpdating,
    updateError,
    updateKey,
    updateSection,
  };
}
