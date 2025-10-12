/**
 * WebSocket Server Worker Entry Point
 * Routes WebSocket connections to Durable Objects
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketDurableObject } from './websocket';

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
    // Get Durable Object ID (use a single instance for now, can be sharded later)
    const id = c.env.WEBSOCKET_DO.idFromName('websocket-instance');
    const stub = c.env.WEBSOCKET_DO.get(id);

    // Forward the request to the Durable Object
    return await stub.fetch(c.req.raw);
  } catch (error) {
    console.error('Error connecting to WebSocket Durable Object:', error);
    return c.json({
      error: 'Failed to establish WebSocket connection',
    }, 500);
  }
});

/**
 * Broadcast endpoint (for server-to-server communication)
 * Allows other services to send messages to connected clients
 */
app.post('/broadcast', async (c) => {
  try {
    const { channel, message } = await c.req.json();

    if (!channel || !message) {
      return c.json({
        error: 'Missing required fields: channel and message',
      }, 400);
    }

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
      return c.json({ success: true });
    } else {
      return c.json({ error: 'Failed to broadcast message' }, 500);
    }
  } catch (error) {
    console.error('Error broadcasting message:', error);
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
    // Get Durable Object
    const id = c.env.WEBSOCKET_DO.idFromName('websocket-instance');
    const stub = c.env.WEBSOCKET_DO.get(id);

    // Request stats
    const response = await stub.fetch(new Request('http://internal/stats'));
    
    if (response.ok) {
      return response;
    } else {
      return c.json({ error: 'Failed to get stats' }, 500);
    }
  } catch (error) {
    console.error('Error getting stats:', error);
    return c.json({
      error: 'Failed to get stats',
    }, 500);
  }
});

/**
 * Default route
 */
app.get('/', (c) => {
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
