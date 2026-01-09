import { OpenAPIRoute, Str, Num } from 'chanfana';
import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { LOG_DIR } from '../index';

interface LogEntry {
  timestamp: string;
  level: string;
  app: string;
  message: string;
  data?: any;
}

export class StreamLogs extends OpenAPIRoute {
  schema = {
    tags: ['Logs'],
    summary: 'Stream combined logs from all apps',
    description: 'Returns a stream of log entries from all apps, sorted by timestamp',
    request: {
      query: z.object({
        lines: Num({ description: 'Number of lines to return (default: 100)', required: false }),
        level: Str({ description: 'Filter by log level (debug, info, warn, error)', required: false }),
        tail: Str({ description: 'If "true", return last N lines instead of first N (default: true)', required: false }),
        app: Str({ description: 'Filter by specific app name', required: false }),
      }),
    },
    responses: {
      '200': {
        description: 'Combined log entries',
        content: {
          'application/json': {
            schema: z.object({
              totalLines: z.number(),
              apps: z.array(z.string()),
              lines: z.array(z.object({
                timestamp: z.string(),
                level: z.string(),
                app: z.string(),
                message: z.string(),
                rawLine: z.string(),
              })),
              filters: z.object({
                level: z.string().nullable(),
                app: z.string().nullable(),
                maxLines: z.number().nullable(),
                tail: z.boolean(),
              }),
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
      const request = await this.getValidatedData<typeof this.schema>();
      const { lines, level, tail, app: appFilter } = request.query;
      const isTail = tail !== 'false'; // Default to true
      const maxLines = lines || 100;

      // Read all log files
      const files = await readdir(LOG_DIR);
      const logFiles = files.filter(f => f.endsWith('.log'));

      // Filter by app if specified
      const filteredFiles = appFilter
        ? logFiles.filter(f => f === `${appFilter}.log`)
        : logFiles;

      // Parse log entries from all files
      const allEntries: Array<{
        timestamp: string;
        level: string;
        app: string;
        message: string;
        rawLine: string;
      }> = [];

      for (const file of filteredFiles) {
        const appName = file.replace('.log', '');
        const logFilePath = join(LOG_DIR, file);

        if (!existsSync(logFilePath)) continue;

        const content = await readFile(logFilePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          // Parse log line format: [timestamp] [LEVEL] message
          const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.+)$/);
          if (match) {
            const [, timestamp, logLevel, message] = match;

            // Filter by level if specified
            if (level && logLevel.toLowerCase() !== level.toLowerCase()) {
              continue;
            }

            allEntries.push({
              timestamp,
              level: logLevel,
              app: appName,
              message,
              rawLine: line,
            });
          }
        }
      }

      // Sort by timestamp (newest first or oldest first depending on tail)
      allEntries.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return isTail ? timeB - timeA : timeA - timeB;
      });

      // Limit number of lines
      const limitedEntries = allEntries.slice(0, maxLines);

      return c.json({
        totalLines: limitedEntries.length,
        apps: [...new Set(filteredFiles.map(f => f.replace('.log', '')))],
        lines: limitedEntries,
        filters: {
          level: level || null,
          app: appFilter || null,
          maxLines,
          tail: isTail,
        },
      });
    } catch (error) {
      console.error('[LOG-SERVICE] Error streaming logs:', error);
      return c.json({
        error: 'Failed to stream logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
}
