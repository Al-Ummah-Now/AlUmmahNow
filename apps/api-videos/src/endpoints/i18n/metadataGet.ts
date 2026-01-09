/**
 * Get i18n Metadata Endpoint
 * GET /api/i18n/metadata
 *
 * Fetches i18n metadata including version, available locales, and checksums for cache invalidation.
 */

import { Str, Bool } from 'chanfana';
import { z } from 'zod';
import { PublicRoute, AppContext } from '../../base';
import { logger } from '../../lib/logger';
import { I18nMetadata } from '@al-ummah/shared-types';

// Default metadata (used as fallback if R2 metadata doesn't exist)
const DEFAULT_METADATA: I18nMetadata = {
  version: '1.0.0',
  locales: ['en', 'ar'],
  defaultLocale: 'en',
  updatedAt: new Date().toISOString(),
  checksums: {},
  sections: [
    'common',
    'header',
    'footer',
    'video',
    'channel',
    'playlist',
    'comment',
    'profile',
    'settings',
    'auth',
    'error',
    'search',
    'upload',
    'moderation',
    'analytics',
    'live',
    'community',
  ],
};

export class GetI18nMetadataEndpoint extends PublicRoute {
  schema = {
    tags: ['i18n'],
    summary: 'Get i18n Metadata',
    description:
      'Fetch i18n metadata including version, available locales, and checksums for cache invalidation.',
    responses: {
      '200': {
        description: 'i18n metadata',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool({ example: true }),
              result: z.object({
                version: Str(),
                locales: z.array(Str()),
                defaultLocale: Str(),
                updatedAt: Str(),
                checksums: z.record(Str()),
                sections: z.array(Str()),
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

      let metadata: I18nMetadata = DEFAULT_METADATA;

      // Try to fetch metadata from R2
      if (bucket) {
        const key = 'translations/metadata.json';
        const object = await bucket.get(key);

        if (object) {
          try {
            metadata = await object.json();
            logger.debug('Loaded i18n metadata from R2');
          } catch (parseError) {
            logger.warn('Failed to parse i18n metadata from R2, using default');
          }
        } else {
          logger.debug('i18n metadata not found in R2, using default');
        }
      } else {
        logger.warn('global_settings bucket not configured, using default metadata');
      }

      return c.json(
        {
          success: true,
          result: metadata,
        },
        200,
        {
          'Cache-Control': 'public, max-age=300', // 5 minutes for metadata
        }
      );
    } catch (error) {
      logger.error('Error fetching i18n metadata:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to fetch i18n metadata',
        },
        500
      );
    }
  }
}
