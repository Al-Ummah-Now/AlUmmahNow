import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_DIR } from '../index';

export class BatchLogEntry extends OpenAPIRoute {
  schema = {
    tags: ['Logging'],
    summary: 'Write multiple log entries',
    description: 'Receives multiple log messages at once and writes them to their respective app-specific log files',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              logs: z.array(z.object({
                app: Str({ description: 'App name' }),
                level: Str({ description: 'Log level' }),
                message: Str({ description: 'Log message' }),
                data: z.unknown().optional(),
              })).min(1).describe('Array of log entries'),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Logs written successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              logsWritten: z.number(),
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
      const { logs } = data.body;

      // Group logs by app for batch writing
      const logsByApp = new Map<string, string>();

      for (const log of logs) {
        const { app: appName, level, message, data: logData } = log;

        const timestamp = new Date().toISOString();
        const dataStr = logData ? ` ${JSON.stringify(logData)}` : '';
        const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

        const existing = logsByApp.get(appName) || '';
        logsByApp.set(appName, existing + logLine);
      }

      // Write all logs
      const writePromises = Array.from(logsByApp.entries()).map(([appName, content]) => {
        const logFilePath = join(LOG_DIR, `${appName}.log`);
        return appendFile(logFilePath, content, 'utf8');
      });

      await Promise.all(writePromises);

      return c.json({
        success: true,
        logsWritten: logs.length,
      });
    } catch (error) {
      console.error('[LOG-SERVICE] Error writing batch logs:', error);
      return c.json({
        error: 'Failed to write batch logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
}
