/**
 * WebSocket Server Worker Entry Point
 * Routes WebSocket connections to Durable Objects
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketDurableObject } from './websocket';
import { createLogger } from '@al-ummah/logger';

// Create logger instance
const logger = createLogger('websocket-server', { logLevel: 'info', forceHttpLogging: true });

// Export the Durable Object
export { WebSocketDurableObject };

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Upgrade', 'Connection'],
  credentials: true,
}));

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  logger.debug('Health check requested');
  return c.json({
    status: 'healthy',
    service: 'websocket-server',
    timestamp: new Date().toISOString(),
  });
});

/**
 * WebSocket endpoint
 * Upgrades HTTP connection to WebSocket and routes to Durable Object
 */
app.get('/ws', async (c) => {
  try {
    logger.info('WebSocket connection request received');

    // Get Durable Object ID (use a single instance for now, can be sharded later)
    const id = c.env.WEBSOCKET_DO.idFromName('websocket-instance');
    const stub = c.env.WEBSOCKET_DO.get(id);

    // Forward the request to the Durable Object
    return await stub.fetch(c.req.raw);
  } catch (error) {
    logger.error('Error connecting to WebSocket Durable Object', error);
    return c.json({
      error: 'Failed to establish WebSocket connection',
    }, 500);
  }
});

/**
 * Broadcast endpoint (for server-to-server communication)
 * Allows other services to send messages to connected clients
 * Requires INTERNAL_API_KEY for authentication
 */
app.post('/broadcast', async (c) => {
  try {
    // Authenticate server-to-server request
    const apiKey = c.req.header('X-API-Key');
    if (!apiKey || apiKey !== c.env.INTERNAL_API_KEY) {
      logger.warn('Broadcast attempt with invalid API key');
      return c.json({
        error: 'Unauthorized - Invalid or missing API key',
      }, 401);
    }

    const { channel, message } = await c.req.json();

    if (!channel || !message) {
      logger.warn('Broadcast request missing required fields');
      return c.json({
        error: 'Missing required fields: channel and message',
      }, 400);
    }

    logger.info(`Broadcasting message to channel: ${channel}`);

    // Get Durable Object
    const id = c.env.WEBSOCKET_DO.idFromName('websocket-instance');
    const stub = c.env.WEBSOCKET_DO.get(id);

    // Call broadcast method
    // Note: This requires exposing broadcast as a fetch endpoint in the DO
    const response = await stub.fetch(new Request('http://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, message }),
    }));

    if (response.ok) {
      logger.info(`Successfully broadcast message to channel: ${channel}`);
      return c.json({ success: true });
    } else {
      logger.error(`Failed to broadcast message to channel: ${channel}`);
      return c.json({ error: 'Failed to broadcast message' }, 500);
    }
  } catch (error) {
    logger.error('Error broadcasting message', error);
    return c.json({
      error: 'Failed to broadcast message',
    }, 500);
  }
});

/**
 * Stats endpoint
 * Returns WebSocket server statistics
 */
app.get('/stats', async (c) => {
  try {
    logger.debug('Stats requested');

    // Get Durable Object
    const id = c.env.WEBSOCKET_DO.idFromName('websocket-instance');
    const stub = c.env.WEBSOCKET_DO.get(id);

    // Request stats
    const response = await stub.fetch(new Request('http://internal/stats'));

    if (response.ok) {
      return response;
    } else {
      logger.error('Failed to get stats from Durable Object');
      return c.json({ error: 'Failed to get stats' }, 500);
    }
  } catch (error) {
    logger.error('Error getting stats', error);
    return c.json({
      error: 'Failed to get stats',
    }, 500);
  }
});

/**
 * Default route
 */
app.get('/', (c) => {
  logger.debug('Root endpoint accessed');
  return c.json({
    service: 'Al Ummah Now - WebSocket Server',
    version: '1.0.0',
    endpoints: {
      websocket: '/ws',
      health: '/health',
      broadcast: 'POST /broadcast',
      stats: '/stats',
    },
    documentation: 'https://github.com/meywd/AlUmmahNow',
  });
});

export default app;
