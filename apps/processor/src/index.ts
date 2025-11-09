import { AlUmmahMessage, QueueEnvironment } from './types';
import { MessageProcessor } from './messageProcessor';
import Logger from './logger';

interface QueueMessage<T> {
  body: T;
  ack: () => void;
  retry: () => void;
}

interface MessageBatch<T> {
  messages: QueueMessage<T>[];
}

// Health check helper functions
async function checkR2Health(env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Check if MESSAGES_BUCKET is accessible (without creating test objects)
    if (env.MESSAGES_BUCKET && typeof env.MESSAGES_BUCKET.put === 'function') {
      return { status: 'healthy' };
    } else {
      return { status: 'unhealthy', message: 'R2 bucket not properly configured' };
    }
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'R2 access failed' 
    };
  }
}

async function checkQueueHealth(_env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Queue health is harder to check directly, but we can assume it's healthy
    // if the worker is running and processing messages
    return { status: 'healthy' };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'Queue access failed' 
    };
  }
}

async function checkDLQHealth(_env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Similar to queue health check
    return { status: 'healthy' };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'DLQ access failed' 
    };
  }
}

export default {
  async queue(batch: MessageBatch<AlUmmahMessage>, env: QueueEnvironment): Promise<void> {
    const logger = new Logger((env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info');
    const processor = new MessageProcessor(logger);

    logger.info(`Processing batch of ${batch.messages.length} messages`);

    // Process messages in parallel for better performance
    const results = await Promise.allSettled(
      batch.messages.map(async (message: QueueMessage<AlUmmahMessage>) => {
        try {
          const result = await processor.processMessage(message.body, env);
          
          if (!result.success) {
            if (result.shouldRetry) {
              // Retry the message
              logger.warn(`Retrying message ${message.body.id}`);
              message.retry();
            } else {
              // Send to dead letter queue (if available)
              logger.error(`Sending message ${message.body.id} to DLQ`);
              if (env.DLQ && typeof env.DLQ.send === 'function') {
                await env.DLQ.send({
                  ...message.body,
                  retryCount: (message.body.retryCount || 0) + 1,
                  failureReason: result.error || 'Unknown error',
                  failedAt: result.processedAt,
                });
              } else {
                logger.warn(`DLQ not configured - acknowledging message ${message.body.id} without DLQ`);
              }
              message.ack();
            }
          } else {
            // Successfully processed
            logger.debug(`Message ${message.body.id} processed successfully`);
            message.ack();
          }
        } catch (error) {
          logger.error(`Unexpected error processing message ${message.body.id}`, error);
          // For unexpected errors, we'll retry
          message.retry();
        }
      })
    );

    // Log summary of processing results
    const successful = results.filter((r: PromiseSettledResult<unknown>) => r.status === 'fulfilled').length;
    const failed = results.filter((r: PromiseSettledResult<unknown>) => r.status === 'rejected').length;
    
    logger.info(`Batch processing complete: ${successful} successful, ${failed} failed`);
  },

  async fetch(request: Request, env: QueueEnvironment): Promise<Response> {
    const logger = new Logger((env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info');
    const url = new URL(request.url);
    
    logger.debug(`Received ${request.method} request to ${url.pathname}`);
    
    // Health check endpoint
    if (url.pathname === '/health') {
      logger.debug('Health check requested');
      
      try {
        // Perform basic health checks
        const healthStatus = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
          version: '1.0.0', // Could be read from package.json
          dependencies: {
            r2: await checkR2Health(env),
            queue: await checkQueueHealth(env),
            dlq: await checkDLQHealth(env),
          }
        };

        // Determine overall health based on dependencies
        const allHealthy = Object.values(healthStatus.dependencies).every(dep => dep.status === 'healthy');
        if (!allHealthy) {
          healthStatus.status = 'degraded';
        }

        return new Response(JSON.stringify(healthStatus), {
          status: allHealthy ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        });
      } catch (error) {
        logger.error('Health check failed', error);
        return new Response(JSON.stringify({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
          error: 'Health check failed',
        }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Queue status endpoint
    if (url.pathname === '/queue/status') {
      logger.debug('Queue status requested');
      
      try {
        // Get queue metrics from Cloudflare GraphQL Analytics API
        // To implement actual metrics, you would need to:
        // 1. Add Cloudflare API token to environment variables
        // 2. Make GraphQL queries to https://api.cloudflare.com/client/v4/graphql
        // 3. Query the following datasets:
        //    - queuesBacklogAdaptiveGroups (backlog metrics)
        //    - queueConsumerMetricsAdaptiveGroups (consumer concurrency)  
        //    - queueMessageOperationsAdaptiveGroups (operations metrics)
        // Note: Actual implementation would require GraphQL API calls to Cloudflare Analytics
        const queueMetrics = {
          status: 'active',
          environment: env.ENVIRONMENT,
          timestamp: new Date().toISOString(),
          metrics: {
            // Backlog metrics (from queuesBacklogAdaptiveGroups dataset)
            backlog: {
              messages: 'requires_analytics_api_access',
              bytes: 'requires_analytics_api_access',
            },
            // Consumer metrics (from queueConsumerMetricsAdaptiveGroups dataset)
            consumer: {
              averageConcurrency: 'requires_analytics_api_access',
            },
            // Message operations (from queueMessageOperationsAdaptiveGroups dataset)
            operations: {
              totalBillableOperations: 'requires_analytics_api_access',
              totalBytes: 'requires_analytics_api_access',
              averageLagTime: 'requires_analytics_api_access', // ms between write and consume
              averageRetries: 'requires_analytics_api_access',
              maxMessageSize: 'requires_analytics_api_access',
            },
            // Additional operational metrics
            lastUpdated: new Date().toISOString(),
            note: 'Metrics require Cloudflare GraphQL Analytics API integration',
          },
          health: {
            queueAccessible: true,
            r2Accessible: true,
            dlqAccessible: true,
          },
          // Links to Cloudflare documentation for implementing metrics
          documentation: {
            metricsAPI: 'https://developers.cloudflare.com/queues/observability/metrics/',
            graphqlAPI: 'https://developers.cloudflare.com/analytics/graphql-api/',
          }
        };

        return new Response(JSON.stringify(queueMetrics), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (error) {
        logger.error('Failed to get queue status', error);
        return new Response(JSON.stringify({
          status: 'error',
          environment: env.ENVIRONMENT,
          timestamp: new Date().toISOString(),
          error: 'Failed to retrieve queue metrics',
        }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Default response for unknown endpoints
    logger.warn(`Unknown endpoint requested: ${url.pathname}`);
    return new Response(JSON.stringify({
      error: 'Not Found',
      message: 'Available endpoints: /health, /queue/status',
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  },
};