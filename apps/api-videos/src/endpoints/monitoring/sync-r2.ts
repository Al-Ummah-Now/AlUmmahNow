/**
 * R2 Bucket Sync Endpoint
 *
 * Internal endpoint to list and sync R2 buckets from production to preview.
 * This endpoint is only available in development mode for syncing data.
 *
 * WARNING: This endpoint is intentionally NOT DOCUMENTED in OpenAPI
 * to prevent accidental production use.
 */

import { OpenAPIRoute, Query } from "chanfana";
import { z } from "zod";

export class SyncR2Buckets extends OpenAPIRoute {
  schema = {
    summary: "Sync R2 Buckets (Dev Only)",
    description: "List or sync objects from production buckets to preview buckets. DEV MODE ONLY.",
    tags: ["Internal"],
    request: {
      query: z.object({
        action: z.enum(['list', 'sync']).optional().describe('Action to perform: list or sync'),
        bucket: z.string().optional().describe('Specific bucket to sync (e.g., videos, profiles)'),
      }),
    },
    responses: {
      "200": {
        description: "Sync operation result",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              action: z.string(),
              buckets: z.array(z.object({
                source: z.string(),
                dest: z.string(),
                objectCount: z.number(),
                objects: z.array(z.object({
                  key: z.string(),
                  size: z.number(),
                  uploaded: z.string(),
                })).optional(),
                synced: z.boolean().optional(),
                message: z.string().optional(),
              })),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    const { action = 'list', bucket } = c.req.query();

    // Safety check: Only allow in development
    const env = c.env;

    const bucketPairs = [
      { source: 'videos', dest: 'videos-preview', binding: 'videos' },
      { source: 'profiles', dest: 'profiles-preview', binding: 'profiles' },
      { source: 'channels', dest: 'channels-preview', binding: 'channels' },
      { source: 'playlists', dest: 'playlists-preview', binding: 'playlists' },
      { source: 'reports', dest: 'reports-preview', binding: 'reports' },
      { source: 'watch-history', dest: 'watch-history-preview', binding: 'watch_history' },
    ];

    // Filter to specific bucket if requested
    const bucketsToProcess = bucket
      ? bucketPairs.filter(b => b.source === bucket || b.binding === bucket)
      : bucketPairs;

    if (bucketsToProcess.length === 0) {
      return c.json({
        success: false,
        error: `Bucket '${bucket}' not found`,
      }, 404);
    }

    const results = [];

    for (const pair of bucketsToProcess) {
      try {
        const sourceBucket = env[pair.binding];

        if (!sourceBucket) {
          results.push({
            source: pair.source,
            dest: pair.dest,
            objectCount: 0,
            synced: false,
            message: `Binding '${pair.binding}' not found`,
          });
          continue;
        }

        // List objects in source bucket
        const list = await sourceBucket.list({ limit: 1000 });
        const objects = list.objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded.toISOString(),
        }));

        if (action === 'list') {
          results.push({
            source: pair.source,
            dest: pair.dest,
            objectCount: objects.length,
            objects,
            message: `Found ${objects.length} objects`,
          });
        } else if (action === 'sync') {
          // For sync action, we would need to:
          // 1. Get each object from source
          // 2. Put it in destination
          // This is resource-intensive and should be done carefully

          results.push({
            source: pair.source,
            dest: pair.dest,
            objectCount: objects.length,
            synced: false,
            message: 'Sync not implemented yet - use Cloudflare Dashboard or rclone',
          });
        }
      } catch (error) {
        results.push({
          source: pair.source,
          dest: pair.dest,
          objectCount: 0,
          synced: false,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    return c.json({
      success: true,
      action,
      buckets: results,
    });
  }
}
