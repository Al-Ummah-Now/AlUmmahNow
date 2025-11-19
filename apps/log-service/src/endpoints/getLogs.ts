import { OpenAPIRoute, Str, Num } from 'chanfana';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { LOG_DIR } from '../index';

export class GetLogs extends OpenAPIRoute {
  schema = {
    tags: ['Logs'],
    summary: 'Get logs from specific app',
    description: 'Returns log entries from a specific app with optional filtering',
    request: {
      params: z.object({
        appName: Str({ description: 'App name (without .log extension)', required: true }),
      }),
      query: z.object({
        lines: Num({ description: 'Number of lines to return', required: false }),
        level: Str({ description: 'Filter by log level (debug, info, warn, error)', required: false }),
        tail: Str({ description: 'If "true", return last N lines instead of first N', required: false }),
      }),
    },
    responses: {
      '200': {
        description: 'Log entries',
        content: {
          'application/json': {
            schema: z.object({
              appName: z.string(),
              totalLines: z.number(),
              lines: z.array(z.string()),
              filters: z.object({
                level: z.string().nullable(),
                maxLines: z.number().nullable(),
                tail: z.boolean(),
              }),
            }),
          },
        },
      },
      '400': {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      '404': {
        description: 'Log file not found',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
              details: z.string().optional(),
            }),
          },
        },
      },
      '500': {
        description: 'Server error',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
              details: z.string().optional(),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const { appName } = data.params;
      const { lines, level, tail } = data.query;
      const isTail = tail === 'true';

      // Validate app name (prevent directory traversal)
      if (appName.includes('..') || appName.includes('/')) {
        return c.json({
          error: 'Invalid app name',
        }, 400);
      }

      const logFilePath = join(LOG_DIR, `${appName}.log`);

      // Check if log file exists
      if (!existsSync(logFilePath)) {
        return c.json({
          error: 'Log file not found',
          details: appName,
        }, 404);
      }

      // Read log file
      const content = await readFile(logFilePath, 'utf8');
      let logLines = content.split('\n').filter(line => line.trim());

      // Filter by level if specified
      if (level) {
        const levelUpper = level.toUpperCase();
        logLines = logLines.filter(line => line.includes(`[${levelUpper}]`));
      }

      // Limit number of lines if specified
      if (lines && lines > 0) {
        if (isTail) {
          // Return last N lines
          logLines = logLines.slice(-lines);
        } else {
          // Return first N lines
          logLines = logLines.slice(0, lines);
        }
      }

      return c.json({
        appName,
        totalLines: logLines.length,
        lines: logLines,
        filters: {
          level: level || null,
          maxLines: lines || null,
          tail: isTail,
        },
      });
    } catch (error) {
      console.error('[LOG-SERVICE] Error reading log file:', error);
      return c.json({
        error: 'Failed to read log file',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
}
