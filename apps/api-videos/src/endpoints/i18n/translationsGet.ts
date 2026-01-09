/**
 * Get Translations Endpoint
 * GET /api/i18n/translations/:locale
 *
 * Fetches full translations for a locale from R2 storage.
 * Supports ETag caching for efficient updates.
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { PublicRoute, AppContext } from '../../base';
import { logger } from '../../lib/logger';
import { TranslationData, SupportedLanguage } from '@al-ummah/shared-types';

const SUPPORTED_LOCALES: SupportedLanguage[] = ['en', 'ar'];

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
        logger.warn(`Translations not found for locale: ${locale}`);
        return c.json(
          {
            success: false,
            error: `Translations not found for locale: ${locale}`,
          },
          404
        );
      }

      // Check ETag for cache validation
      const etag = object.etag;
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

      logger.info(`Fetched translations for locale: ${locale}, version: ${translationData.version}`);

      return c.json(
        {
          success: true,
          result: {
            locale: translationData.locale,
            version: translationData.version,
            updatedAt: translationData.updatedAt,
            translations: translationData.translations,
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
