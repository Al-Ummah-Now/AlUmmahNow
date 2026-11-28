import { OpenAPIRoute } from 'chanfana';
import { formatLogLine, logEntry } from '../lib/log-record';
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
            schema: z.object({ logs: z.array(logEntry).min(1).max(500) }),
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
    const { body: { logs } } = await this.getValidatedData<typeof this.schema>();
    try {

      // Group logs by app for batch writing
      const logsByApp = new Map<string, string>();

      for (const log of logs) {
        const existing = logsByApp.get(log.app) || '';
        logsByApp.set(log.app, existing + formatLogLine(log));
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
