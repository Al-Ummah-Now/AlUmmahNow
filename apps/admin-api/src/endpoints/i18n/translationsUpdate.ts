/**
 * Update Translations Endpoint
 * PUT /api/i18n/translations/:locale
 *
 * Admin endpoint to update translations for a locale.
 * Requires admin/moderator role.
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { AdminRoute } from '../../base/AdminRoute';
import { AppContext } from '../../base/types';
import { logger } from '../../lib/logger';
import {
  TranslationData,
  I18nMetadata,
  AppTranslations,
  SupportedLanguage,
} from '@al-ummah/shared-types';

const SUPPORTED_LOCALES: SupportedLanguage[] = ['en', 'ar'];

function computeChecksum(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  return `${data.length}-${sum.toString(16)}`;
}

function deepMerge(target: any, source: any): any {
  const output = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }
  return output;
}

export class UpdateTranslationsEndpoint extends AdminRoute {
  schema = {
    tags: ['i18n'],
    summary: 'Update Translations',
    description: 'Update translations for a specific locale. Requires admin role.',
    request: {
      params: z.object({
        locale: z.enum(['en', 'ar']).describe('Locale code (en or ar)'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              translations: z.record(z.any()).describe('Translation key-value pairs'),
              merge: Bool({
                description: 'Whether to merge with existing translations or replace',
                default: true,
              }).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Translations updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: true }),
              result: z.object({
                locale: Str(),
                version: Str(),
                updatedAt: Str(),
              }),
            }),
          },
        },
      },
      '400': {
        description: 'Invalid locale or request body',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: false }),
              error: Str(),
            }),
          },
        },
      },
      '401': {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: false }),
              error: Str(),
            }),
          },
        },
      },
      '403': {
        description: 'Forbidden - Admin role required',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: false }),
              error: Str(),
            }),
          },
        },
      },
      '500': {
        description: 'Internal server error',
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
      const body = data.body as { translations: Partial<AppTranslations>; merge?: boolean };
      const { translations: newTranslations, merge = true } = body;

      const userId = this.getUserId(c);

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

      const now = new Date().toISOString();
      let existingData: TranslationData | null = null;

      // Fetch existing translations if merging
      if (merge) {
        const key = `translations/${locale}.json`;
        const object = await bucket.get(key);
        if (object) {
          try {
            existingData = await object.json();
          } catch {
            logger.warn('Failed to parse existing translations');
          }
        }
      }

      // Get existing version or start at 1.0.0
      const existingVersion = existingData?.version || '1.0.0';
      const [major, minor, patch] = existingVersion.split('.').map(Number);
      const newVersion = `${major}.${minor}.${patch + 1}`;

      // Prepare merged or new translations
      let finalTranslations: AppTranslations;
      if (merge && existingData) {
        finalTranslations = deepMerge(existingData.translations, newTranslations);
      } else {
        finalTranslations = newTranslations as AppTranslations;
      }

      // Prepare translation data
      const translationData: TranslationData = {
        version: newVersion,
        locale,
        updatedAt: now,
        translations: finalTranslations,
      };

      // Upload updated translations
      const translationJson = JSON.stringify(translationData, null, 2);
      await bucket.put(`translations/${locale}.json`, translationJson, {
        httpMetadata: { contentType: 'application/json' },
      });

      logger.info(`Updated ${locale} translations`, {
        userId,
        locale,
        version: newVersion,
        merge,
      });

      // Update metadata
      let metadata: I18nMetadata;
      const metadataObject = await bucket.get('translations/metadata.json');
      if (metadataObject) {
        metadata = await metadataObject.json();
      } else {
        metadata = {
          version: '1.0.0',
          locales: SUPPORTED_LOCALES,
          defaultLocale: 'en',
          updatedAt: now,
          checksums: {},
          sections: Object.keys(finalTranslations),
        };
      }

      // Update checksum for this locale
      metadata.checksums[locale] = computeChecksum(translationJson);
      metadata.updatedAt = now;
      metadata.version = newVersion;

      // Upload updated metadata
      await bucket.put('translations/metadata.json', JSON.stringify(metadata, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });

      // Broadcast translation update via WebSocket
      try {
        const websocketUrl = c.env.WEBSOCKET_URL;
        const internalApiKey = c.env.INTERNAL_API_KEY;

        if (websocketUrl && internalApiKey) {
          const broadcastResponse = await fetch(`${websocketUrl}/broadcast`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': internalApiKey,
            },
            body: JSON.stringify({
              channel: 'system:i18n',
              message: {
                type: 'translations:updated',
                locale,
                version: newVersion,
                updatedAt: now,
                checksum: metadata.checksums[locale],
              },
            }),
          });

          if (broadcastResponse.ok) {
            logger.info(`Broadcast translations update for ${locale}`);
          } else {
            logger.warn(`Failed to broadcast translations update: ${broadcastResponse.status}`);
          }
        }
      } catch (broadcastError) {
        // Don't fail the request if broadcast fails
        logger.warn('Failed to broadcast translations update:', broadcastError);
      }

      return c.json({
        success: true,
        result: {
          locale,
          version: newVersion,
          updatedAt: now,
        },
      });
    } catch (error) {
      logger.error('Error updating translations:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to update translations',
        },
        500
      );
    }
  }
}
