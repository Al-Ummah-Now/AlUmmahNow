/**
 * Sync/Seed Translations Endpoint
 * POST /api/i18n/sync
 *
 * Seeds R2 storage with initial translation files.
 * This endpoint is used for development and initial setup.
 *
 * The seed is the web app's static translations, imported from
 * @al-ummah/shared-types, so the stored copy cannot drift from them.
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { PublicRoute, AppContext } from '../../base';
import { logger } from '../../lib/logger';
import {
  AR_TRANSLATIONS,
  EN_TRANSLATIONS,
  TranslationData,
  I18nMetadata,
  I18nConfig,
} from '@al-ummah/shared-types';

const INITIAL_VERSION = '1.0.0';

/** Parse a `major.minor.patch` version; null when it is not one. */
function parseVersion(version: unknown): [number, number, number] | null {
  if (typeof version !== 'string') return null;
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return [parts[0], parts[1], parts[2]];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The version to seed with: one patch above the highest version already stored
 * (so clients holding the old copy see a change and refetch), or 1.0.0 for an
 * empty store.
 */
export function nextSeedVersion(storedVersions: unknown[]): string {
  const parsed = storedVersions.map(parseVersion).filter((v): v is [number, number, number] => v !== null);
  if (parsed.length === 0) return INITIAL_VERSION;
  const [major, minor, patch] = parsed.sort(compareVersions)[parsed.length - 1];
  return `${major}.${minor}.${patch + 1}`;
}

async function readStoredVersion(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const data = (await object.json()) as { version?: unknown };
    return data.version;
  } catch (error) {
    logger.warn(`Ignoring unreadable ${key} while computing the seed version`, error);
    return null;
  }
}


function computeChecksum(data: string): string {
  // Simple checksum based on string length and character sum
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  return `${data.length}-${sum.toString(16)}`;
}

export class SyncTranslationsEndpoint extends PublicRoute {
  schema = {
    tags: ['i18n'],
    summary: 'Sync/Seed Translations',
    description:
      'Seeds R2 storage with initial translation files. This endpoint is used for development and initial setup.',
    responses: {
      '200': {
        description: 'Translations synced successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: true }),
              result: z.object({
                synced: z.array(Str()),
                version: Str(),
                updatedAt: Str(),
              }),
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
      const bucket = c.env.global_settings;
      if (!bucket) {
        return c.json(
          {
            success: false,
            error: 'global_settings bucket not configured',
          },
          500
        );
      }

      const now = new Date().toISOString();
      const version = nextSeedVersion(
        await Promise.all(
          ['translations/en.json', 'translations/ar.json', 'translations/metadata.json'].map((key) =>
            readStoredVersion(bucket, key)
          )
        )
      );
      const synced: string[] = [];

      // Prepare translation data
      const enData: TranslationData = {
        version,
        locale: 'en',
        updatedAt: now,
        translations: EN_TRANSLATIONS,
      };

      // Upload English translations
      const enJson = JSON.stringify(enData, null, 2);
      await bucket.put('translations/en.json', enJson, {
        httpMetadata: { contentType: 'application/json' },
      });
      synced.push('en');
      logger.debug('Synced English translations to R2');

      // Prepare Arabic translation data
      const arData: TranslationData = {
        version,
        locale: 'ar',
        updatedAt: now,
        translations: AR_TRANSLATIONS,
      };

      // Upload Arabic translations
      const arJson = JSON.stringify(arData, null, 2);
      await bucket.put('translations/ar.json', arJson, {
        httpMetadata: { contentType: 'application/json' },
      });
      synced.push('ar');
      logger.debug('Synced Arabic translations to R2');

      // Compute checksums
      const checksums: Record<string, string> = {
        en: computeChecksum(enJson),
        ar: computeChecksum(arJson),
      };

      // Prepare metadata
      const metadata: I18nMetadata = {
        version,
        locales: ['en', 'ar'],
        defaultLocale: 'en',
        updatedAt: now,
        checksums,
        sections: Object.keys(EN_TRANSLATIONS),
      };

      // Upload metadata
      await bucket.put('translations/metadata.json', JSON.stringify(metadata, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });
      logger.debug('Synced translations metadata to R2');

      // Prepare config
      const config: I18nConfig = {
        locales: [
          {
            code: 'en',
            name: 'English',
            englishName: 'English',
            isRTL: false,
            isDefault: true,
            isComplete: true,
          },
          {
            code: 'ar',
            name: 'العربية',
            englishName: 'Arabic',
            isRTL: true,
            isDefault: false,
            isComplete: true,
          },
        ],
        fallbackLocale: 'en',
        cacheMaxAge: 3600,
        version,
      };

      // Upload config
      await bucket.put('config/i18n-config.json', JSON.stringify(config, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });
      logger.debug('Synced i18n config to R2');

      return c.json({
        success: true,
        result: {
          synced,
          version,
          updatedAt: now,
        },
      });
    } catch (error) {
      logger.error('Error syncing translations:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to sync translations',
        },
        500
      );
    }
  }
}
