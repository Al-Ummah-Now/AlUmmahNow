/**
 * Get i18n Config Endpoint
 * GET /api/i18n/config
 *
 * Fetches i18n configuration including available locales and RTL settings.
 */

import { Str, Bool, Num } from 'chanfana';
import { z } from 'zod';
import { PublicRoute, AppContext } from '../../base';
import { logger } from '../../lib/logger';
import { I18nConfig, LocaleConfig } from '@al-ummah/shared-types';

// Default configuration (used as fallback if R2 config doesn't exist)
const DEFAULT_CONFIG: I18nConfig = {
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
  version: '1.0.0',
};

export class GetI18nConfigEndpoint extends PublicRoute {
  schema = {
    tags: ['i18n'],
    summary: 'Get i18n Configuration',
    description: 'Fetch i18n configuration including available locales, RTL settings, and caching parameters.',
    responses: {
      '200': {
        description: 'i18n configuration',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: true }),
              result: z.object({
                locales: z.array(
                  z.object({
                    code: Str(),
                    name: Str(),
                    englishName: Str(),
                    isRTL: Bool(),
                    isDefault: Bool().optional(),
                    isComplete: Bool().optional(),
                  })
                ),
                fallbackLocale: Str(),
                cacheMaxAge: Num(),
                version: Str(),
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
      // Get the global_settings bucket
      const bucket = c.env.global_settings;

      let config: I18nConfig = DEFAULT_CONFIG;

      // Try to fetch config from R2
      if (bucket) {
        const key = 'config/i18n-config.json';
        const object = await bucket.get(key);

        if (object) {
          try {
            config = await object.json();
            logger.debug('Loaded i18n config from R2');
          } catch (parseError) {
            logger.warn('Failed to parse i18n config from R2, using default');
          }
        } else {
          logger.debug('i18n config not found in R2, using default');
        }
      } else {
        logger.warn('global_settings bucket not configured, using default config');
      }

      return c.json(
        {
          success: true,
          result: config,
        },
        200,
        {
          'Cache-Control': `public, max-age=${config.cacheMaxAge}`,
        }
      );
    } catch (error) {
      logger.error('Error fetching i18n config:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to fetch i18n configuration',
        },
        500
      );
    }
  }
}
