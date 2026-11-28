import { OpenAPIRoute } from 'chanfana';
import { formatLogLine, logEntry } from '../lib/log-record';
import { z } from 'zod';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOG_DIR } from '../index';

export class LogEntry extends OpenAPIRoute {
  schema = {
    tags: ['Logging'],
    summary: 'Write single log entry',
    description: 'Receives a single log message and writes it to an app-specific log file',
    request: {
      body: {
        content: {
          'application/json': {
            schema: logEntry,
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Log written successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
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
    const { body: log } = await this.getValidatedData<typeof this.schema>();
    try {

      // Write to app-specific log file
      const logFilePath = join(LOG_DIR, `${log.app}.log`);
      await appendFile(logFilePath, formatLogLine(log), 'utf8');

      return c.json({ success: true });
    } catch (error) {
      console.error('[LOG-SERVICE] Error writing log:', error);
      return c.json({
        error: 'Failed to write log',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
}
