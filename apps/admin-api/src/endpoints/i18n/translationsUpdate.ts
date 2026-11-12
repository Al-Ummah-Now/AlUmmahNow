/**
 * Update Translations Endpoint
 * PUT /api/i18n/translations/:locale
 *
 * Admin endpoint to update translations for a locale.
 * Requires admin/moderator role.
 */

import { updateJson, type CasBucket } from '../../lib/r2Cas';
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
  AR_TRANSLATIONS,
  EN_TRANSLATIONS,
  effectiveOverrides,
  nextTranslationOverrides,
} from '@al-ummah/shared-types';

const SUPPORTED_LOCALES: SupportedLanguage[] = ['en', 'ar'];

export function computeChecksum(data: string): string {
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

/**
 * Saves one locale's translations and its checksum in metadata.json with
 * conditional writes (SCALABILITY-AUDIT AA-5): two admins saving at once each
 * apply their change to the other's result instead of overwriting it.
 */
export async function saveTranslations(
  bucket: CasBucket,
  locale: SupportedLanguage,
  newTranslations: unknown,
  merge: boolean,
  now: string,
): Promise<{ newVersion: string; translationJson: string }> {
  let finalTranslations!: AppTranslations;
  let newVersion = '1.0.1';
  let translationJson = '';
  await updateJson<TranslationData>(
    bucket,
    `translations/${locale}.json`,
    (existing) => {
      const existingData = merge ? existing : null;
      const [major, minor, patch] = (existingData?.version || '1.0.0').split('.').map(Number);
      newVersion = `${major}.${minor}.${patch + 1}`;
      finalTranslations = merge && existingData
        ? deepMerge(existingData.translations, newTranslations)
        : (newTranslations as AppTranslations);
      // #982: record which keys an admin set, so only those win over the
      // repo's static text; a key saved back to the repo value leaves the list.
      const defaults = locale === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS;
      const previous = existingData ? effectiveOverrides(defaults, existingData) : [];
      const translationData: TranslationData = {
        version: newVersion,
        locale,
        updatedAt: now,
        translations: finalTranslations,
        overrides: nextTranslationOverrides(previous, newTranslations, defaults),
      };
      translationJson = JSON.stringify(translationData, null, 2);
      return translationData;
    },
    { pretty: true },
  );

  // Only this locale's checksum changes, on top of whatever other locales' saves wrote meanwhile.
  // The checksum is taken from the locale file as it is now (read inside the
  // retry loop), so a later save of the same locale can never be described
  // by an earlier save's checksum.
  await updateJson<I18nMetadata>(
    bucket,
    'translations/metadata.json',
    async (current) => {
      const stored = await bucket.get(`translations/${locale}.json`);
      const storedJson = stored ? await stored.text() : translationJson;
      const metadata: I18nMetadata = current ?? {
        version: '1.0.0',
        locales: SUPPORTED_LOCALES,
        defaultLocale: 'en',
        updatedAt: now,
        checksums: {},
        sections: Object.keys(finalTranslations),
      };
      metadata.checksums = { ...metadata.checksums, [locale]: computeChecksum(storedJson) };
      metadata.updatedAt = now;
      metadata.version = newVersion;
      return metadata;
    },
    { pretty: true },
  );
  return { newVersion, translationJson };
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
    // Outside the catch-all: a bad request is chanfana's 400, not a 500
    const data = await this.getValidatedData<typeof this.schema>();
    try {
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
      const { newVersion, translationJson } = await saveTranslations(
        bucket as unknown as CasBucket,
        locale as SupportedLanguage,
        newTranslations,
        merge,
        now,
      );

      logger.info(`Updated ${locale} translations`, {
        userId,
        locale,
        version: newVersion,
        merge,
      });

      // Broadcast translation update via WebSocket
      try {
        const websocketUrl = c.env.WEBSOCKET_URL;
        const keyBinding = c.env.INTERNAL_API_KEY;
        const internalApiKey = typeof keyBinding === 'string' ? keyBinding : await keyBinding?.get();

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
                checksum: computeChecksum(translationJson),
              },
            }),
          });

          if (broadcastResponse.ok) {
            logger.debug(`Broadcast translations update for ${locale}`);
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
