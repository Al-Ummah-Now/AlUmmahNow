import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { LOG_DIR } from '../index';

export class ListLogFiles extends OpenAPIRoute {
  schema = {
    tags: ['Logs'],
    summary: 'List available log files',
    description: 'Returns a list of all available log files in the log directory',
    responses: {
      '200': {
        description: 'List of log files',
        content: {
          'application/json': {
            schema: z.object({
              logDirectory: z.string(),
              files: z.array(z.string()),
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
      const files = await readdir(LOG_DIR);
      const logFiles = files.filter(f => f.endsWith('.log'));

      return c.json({
        logDirectory: LOG_DIR,
        files: logFiles,
      });
    } catch (error) {
      return c.json({
        error: 'Failed to read log directory',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
}
