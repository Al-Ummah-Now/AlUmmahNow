import { OpenAPIRoute } from 'chanfana';
import { Str } from '../lib/chanfana-params';
import { z } from 'zod';
import { LOG_DIR } from '../index';

export class HealthCheck extends OpenAPIRoute {
  schema = {
    tags: ['System'],
    summary: 'Health check',
    description: 'Check if the logging service is running',
    responses: {
      '200': {
        description: 'Service is healthy',
        content: {
          'application/json': {
            schema: z.object({
              status: z.string(),
              service: z.string(),
              logDirectory: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    return c.json({
      status: 'healthy',
      service: 'log-service',
      logDirectory: LOG_DIR,
    });
  }
}
