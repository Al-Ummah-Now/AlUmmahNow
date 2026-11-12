/**
 * Get Translations Endpoint
 * GET /api/i18n/translations/:locale
 *
 * Fetches full translations for a locale from R2 storage.
 * Supports ETag caching for efficient updates.
 *
 * The answer is the repo's static translations with the keys an admin edited
 * (the stored file's `overrides`) taken from the store, so a string changed in
 * the repo is served as soon as this worker deploys (#982). A file without
 * `overrides` (written before #982) is served as stored.
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { PublicRoute, AppContext } from '../../base';
import { logger } from '../../lib/logger';
import {
  TranslationData,
  SupportedLanguage,
  AR_TRANSLATIONS,
  EN_TRANSLATIONS,
  applyTranslationOverrides,
  storedOverrides,
} from '@al-ummah/shared-types';

const SUPPORTED_LOCALES: SupportedLanguage[] = ['en', 'ar'];

const STATIC_TRANSLATIONS = { en: EN_TRANSLATIONS, ar: AR_TRANSLATIONS } as const;

const staticFingerprints = new Map<string, string>();

/** A short hash of this build's static translations, so the ETag changes when a deploy changes them. */
export function staticFingerprint(locale: SupportedLanguage): string {
  let fingerprint = staticFingerprints.get(locale);
  if (!fingerprint) {
    const json = JSON.stringify(STATIC_TRANSLATIONS[locale]);
    let hash = 0;
    for (let i = 0; i < json.length; i++) hash = (Math.imul(hash, 31) + json.charCodeAt(i)) | 0;
    fingerprint = `${json.length.toString(36)}${(hash >>> 0).toString(36)}`;
    staticFingerprints.set(locale, fingerprint);
  }
  return fingerprint;
}

export class GetTranslationsEndpoint extends PublicRoute {
  schema = {
    tags: ['i18n'],
    summary: 'Get Translations',
    description: 'Fetch full translations for a specific locale. Supports ETag caching.',
    request: {
      params: z.object({
        locale: z.enum(['en', 'ar']).describe('Locale code (en or ar)'),
      }),
      headers: z.object({
        'if-none-match': Str({ description: 'ETag for cache validation' }).optional().nullable(),
      }),
    },
    responses: {
      '200': {
        description: 'Translations for the requested locale',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: true }),
              result: z.object({
                locale: Str(),
                version: Str(),
                updatedAt: Str(),
                translations: z.any(),
                overrides: z
                  .array(Str())
                  .optional()
                  .describe('Keys an admin edited (dotted paths); only these differ from the repo text'),
              }),
            }),
          },
        },
      },
      '304': {
        description: 'Not Modified - client cache is valid',
      },
      '400': {
        description: 'Invalid locale',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: false }),
              error: Str(),
            }),
          },
        },
      },
      '404': {
        description: 'Translations not found',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: false }),
              error: Str(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const { locale } = data.params;
      const ifNoneMatch = c.req.header('if-none-match');

      // Validate locale
      if (!SUPPORTED_LOCALES.includes(locale as SupportedLanguage)) {
        return c.json(
          {
            success: false,
            error: `Invalid locale: ${locale}. Supported: ${SUPPORTED_LOCALES.join(', ')}`,
          },
          400
        );
      }

      // Get the global_settings bucket
      const bucket = c.env.global_settings;
      if (!bucket) {
        logger.error('global_settings bucket not configured');
        return c.json(
          {
            success: false,
            error: 'i18n storage not configured',
          },
          500
        );
      }

      // Fetch translations from R2
      const key = `translations/${locale}.json`;
      const object = await bucket.get(key);

      if (!object) {
        logger.debug(`Translations not found for locale: ${locale}`);
        return c.json(
          {
            success: false,
            error: `Translations not found for locale: ${locale}`,
          },
          404
        );
      }

      // Check ETag for cache validation: the stored file and this build's static text
      const etag = `${object.etag}-${staticFingerprint(locale as SupportedLanguage)}`;
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      // Parse and return translations
      const translationData: TranslationData = await object.json();
      const overrides = storedOverrides(translationData);
      const translations = overrides
        ? applyTranslationOverrides(STATIC_TRANSLATIONS[locale as SupportedLanguage], translationData.translations, overrides)
        : translationData.translations;

      logger.debug(`Fetched translations for locale: ${locale}, version: ${translationData.version}`);

      return c.json(
        {
          success: true,
          result: {
            locale: translationData.locale,
            version: translationData.version,
            updatedAt: translationData.updatedAt,
            translations,
            ...(overrides ? { overrides } : {}),
          },
        },
        200,
        {
          'ETag': etag,
          'Cache-Control': 'public, max-age=3600',
        }
      );
    } catch (error) {
      logger.error('Error fetching translations:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to fetch translations',
        },
        500
      );
    }
  }
}
