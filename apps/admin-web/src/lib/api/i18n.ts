'use server';

/**
 * i18n API Client for Admin Web
 *
 * Provides server actions for fetching and updating translations.
 * - GET operations use the main API (api-videos)
 * - PUT operations use the admin API (admin-api)
 */

import type {
  TranslationData,
  I18nConfig,
  I18nMetadata,
  SupportedLanguage,
  AppTranslations,
} from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

function getApiUrl(): string {
  return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3086';
}

function getAdminApiUrl(): string {
  return process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';
}

/**
 * Fetch translations from the main API
 */
export async function getTranslations(
  locale: SupportedLanguage
): Promise<TranslationData | null> {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`[i18n] Fetching translations`, { requestId, locale });

  try {
    const url = `${getApiUrl()}/api/i18n/translations/${locale}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    logger.debug(`[i18n] Response received`, {
      requestId,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      logger.error(`[i18n] Failed to fetch translations`, {
        requestId,
        locale,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as { success: boolean; result: TranslationData };

    if (data.success && data.result) {
      logger.info(`[i18n] Translations fetched successfully`, { requestId, locale });
      return data.result;
    }

    logger.warn(`[i18n] Response success=false or no result`, { requestId, locale });
    return null;
  } catch (error) {
    logger.error(`[i18n] Error fetching translations`, {
      requestId,
      locale,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch i18n configuration
 */
export async function getI18nConfig(): Promise<I18nConfig | null> {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`[i18n] Fetching config`, { requestId });

  try {
    const response = await fetch(`${getApiUrl()}/api/i18n/config`, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.error(`[i18n] Failed to fetch config`, {
        requestId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as { success: boolean; result: I18nConfig };

    if (data.success && data.result) {
      logger.info(`[i18n] Config fetched successfully`, { requestId });
      return data.result;
    }

    logger.warn(`[i18n] Config response success=false or no result`, { requestId });
    return null;
  } catch (error) {
    logger.error('[i18n] Error fetching config', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch i18n metadata
 */
export async function getI18nMetadata(): Promise<I18nMetadata | null> {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`[i18n] Fetching metadata`, { requestId });

  try {
    const response = await fetch(`${getApiUrl()}/api/i18n/metadata`, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      logger.error(`[i18n] Failed to fetch metadata`, {
        requestId,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as { success: boolean; result: I18nMetadata };

    if (data.success && data.result) {
      logger.info(`[i18n] Metadata fetched successfully`, { requestId });
      return data.result;
    }

    logger.warn(`[i18n] Metadata response success=false or no result`, { requestId });
    return null;
  } catch (error) {
    logger.error('[i18n] Error fetching metadata', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Update translations via admin API
 */
export async function updateTranslations(
  locale: SupportedLanguage,
  translations: Partial<AppTranslations>,
  mode: 'merge' | 'replace' = 'merge'
): Promise<{ success: boolean; error?: string }> {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`[i18n] Updating translations`, { requestId, locale, mode });

  try {
    const session = await getAdminSession();

    if (!session) {
      logger.error(`[i18n] Not authenticated for update`, { requestId, locale });
      return { success: false, error: 'Not authenticated' };
    }

    logger.debug(`[i18n] Session retrieved for update`, {
      requestId,
      hasAccessToken: !!session.accessToken,
    });

    const response = await fetch(`${getAdminApiUrl()}/api/i18n/translations/${locale}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ translations, mode }),
    });

    logger.info(`[i18n] Update response`, {
      requestId,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      logger.error(`[i18n] Failed to update translations`, {
        requestId,
        locale,
        status: response.status,
        error: errorData,
      });
      return {
        success: false,
        error: errorData.error || `Failed to update translations: ${response.statusText}`,
      };
    }

    const data = await response.json() as { success: boolean };
    logger.info(`[i18n] Translations updated successfully`, { requestId, locale });
    return { success: data.success };
  } catch (error) {
    logger.error(`[i18n] Error updating translations`, {
      requestId,
      locale,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync translations from static files to R2
 */
export async function syncTranslations(): Promise<{ success: boolean; error?: string }> {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  logger.info(`[i18n] Syncing translations`, { requestId });

  try {
    const session = await getAdminSession();

    if (!session) {
      logger.error(`[i18n] Not authenticated for sync`, { requestId });
      return { success: false, error: 'Not authenticated' };
    }

    logger.debug(`[i18n] Session retrieved for sync`, {
      requestId,
      hasAccessToken: !!session.accessToken,
    });

    const response = await fetch(`${getApiUrl()}/api/i18n/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
    });

    logger.info(`[i18n] Sync response`, {
      requestId,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      logger.error(`[i18n] Failed to sync translations`, {
        requestId,
        status: response.status,
        error: errorData,
      });
      return {
        success: false,
        error: errorData.error || `Failed to sync translations: ${response.statusText}`,
      };
    }

    const data = await response.json() as { success: boolean };
    logger.info(`[i18n] Translations synced successfully`, { requestId });
    return { success: data.success };
  } catch (error) {
    logger.error('[i18n] Error syncing translations', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
