/**
 * WebSocket Server Worker Entry Point
 * Routes WebSocket connections to Durable Objects
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketDurableObject, MAX_BROADCAST_ITEMS } from './websocket';
import { broadcastToShards, readAllShards, shardsInRandomOrder, type BroadcastItem } from './shards';
import { createLogger } from '@al-ummah/logger';

// Create logger instance
const logger = createLogger('websocket-server', { logLevel: 'info', forceHttpLogging: true });

// Export the Durable Object
export { WebSocketDurableObject };

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
type RateLimitedEnv = Env & { WS_CONNECT_LIMITER?: RateLimiter };
interface ShardStats {
  connections: number;
  channels: number;
  sessions: number;
  channelDetails?: Record<string, number>;
}

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
    // Worker version id serving this request (the release smoke checks it)
    deployment: (c.env as { CF_VERSION_METADATA?: { id: string } }).CF_VERSION_METADATA?.id ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

/**
 * WebSocket endpoint
 * Upgrades HTTP connection to WebSocket and routes to Durable Object
 */
app.get('/ws', async (c) => {
  try {
    // Opening sockets is limited per IP (Workers Rate Limiting, per location, no KV)
    const ip = c.req.header('CF-Connecting-IP');
    const limiter = (c.env as RateLimitedEnv).WS_CONNECT_LIMITER;
    if (limiter && ip) {
      const { success } = await limiter.limit({ key: `ip:${ip}` });
      if (!success) return c.json({ error: 'Too many connections' }, 429);
    }

    // A random shard takes the socket; a full shard (503) passes it to the next
    let last: Response | undefined;
    for (const name of shardsInRandomOrder(c.env)) {
      const stub = c.env.WEBSOCKET_DO.get(c.env.WEBSOCKET_DO.idFromName(name));
      last = await stub.fetch(c.req.raw);
      if (last.status !== 503) return last;
    }
    return last ?? c.json({ error: 'Connection limit reached' }, 503);
  } catch (error) {
    logger.error('Error connecting to WebSocket Durable Object', error);
    return c.json({
      error: 'Failed to establish WebSocket connection',
    }, 500);
  }
});

/** Checks the X-API-Key header against INTERNAL_API_KEY. */
async function hasInternalKey(c: { req: { header(name: string): string | undefined }; env: Env }): Promise<boolean> {
  const apiKey = c.req.header('X-API-Key');
  let expectedApiKey: string | undefined;
  if (c.env.INTERNAL_API_KEY) {
    if (typeof c.env.INTERNAL_API_KEY === 'string') {
      expectedApiKey = c.env.INTERNAL_API_KEY;
    } else if (typeof c.env.INTERNAL_API_KEY.get === 'function') {
      expectedApiKey = await c.env.INTERNAL_API_KEY.get();
    }
  }
  return Boolean(apiKey && expectedApiKey && apiKey === expectedApiKey);
}

/**
 * Broadcast endpoint (for server-to-server communication)
 * Allows other services to send messages to connected clients
 * Requires INTERNAL_API_KEY for authentication
 */
app.post('/broadcast', async (c) => {
  try {
    if (!(await hasInternalKey(c))) {
      logger.warn('Broadcast attempt with invalid API key');
      return c.json({
        error: 'Unauthorized - Invalid or missing API key',
      }, 401);
    }

    // One event `{ channel, message }`, or many `{ items: [{ channel, message }] }` in one call
    const body = await c.req.json<{ channel?: string; message?: unknown; items?: BroadcastItem[] }>();
    const items: BroadcastItem[] = Array.isArray(body.items)
      ? body.items
      : [{ channel: body.channel as string, message: body.message }];

    if (items.length === 0 || items.length > MAX_BROADCAST_ITEMS || items.some((i) => !i?.channel || !i.message)) {
      logger.warn('Broadcast request missing required fields');
      return c.json({
        error: 'Missing required fields: channel and message',
      }, 400);
    }

    // Every socket shard delivers to its own subscribers
    const result = await broadcastToShards(c.env.WEBSOCKET_DO, c.env, items);
    if (result.failed === 0) {
      return c.json({ success: true, delivered: result.delivered });
    }
    logger.error(`Broadcast failed on ${result.failed} of ${result.shards} shards`);
    return c.json({ error: 'Failed to broadcast message', ...result }, 500);
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

    // Totals across every socket shard
    const { bodies, failed } = await readAllShards<ShardStats>(c.env.WEBSOCKET_DO, c.env, '/stats');
    if (bodies.length === 0) {
      logger.error('Failed to get stats from Durable Object');
      return c.json({ error: 'Failed to get stats' }, 500);
    }
    const channelDetails: Record<string, number> = {};
    for (const b of bodies) {
      for (const [channel, n] of Object.entries(b.channelDetails ?? {})) {
        channelDetails[channel] = (channelDetails[channel] ?? 0) + n;
      }
    }
    return c.json({
      connections: bodies.reduce((n, b) => n + b.connections, 0),
      channels: Object.keys(channelDetails).length,
      sessions: bodies.reduce((n, b) => n + b.sessions, 0),
      channelDetails,
      shards: bodies.length + failed,
      unavailableShards: failed,
    });
  } catch (error) {
    logger.error('Error getting stats', error);
    return c.json({
      error: 'Failed to get stats',
    }, 500);
  }
});

/**
 * Presence (internal): how many signed-in sockets a user has open right now,
 * counted from the live sockets on every shard.
 */
app.get('/presence/:userId', async (c) => {
  if (!(await hasInternalKey(c))) return c.json({ error: 'Unauthorized - Invalid or missing API key' }, 401);
  const userId = c.req.param('userId');
  const { bodies, failed } = await readAllShards<{ sessions: number }>(
    c.env.WEBSOCKET_DO, c.env, `/presence?userId=${encodeURIComponent(userId)}`,
  );
  if (failed > 0) return c.json({ error: 'Presence unavailable' }, 503);
  const sessions = bodies.reduce((n, b) => n + b.sessions, 0);
  return c.json({ userId, online: sessions > 0, sessions });
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
      presence: 'GET /presence/:userId (internal)',
    },
    documentation: 'https://github.com/meywd/AlUmmahNow',
  });
});

export default app;
