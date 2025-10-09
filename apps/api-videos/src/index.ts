import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { VideoObject } from '@al-ummah/shared-types';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  }
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true
});

await fastify.register(helmet, {
  contentSecurityPolicy: false
});

// Health check endpoint
fastify.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'al-ummah-api-videos',
    version: '1.0.0'
  };
});

// Example videos endpoint using shared types
fastify.get<{ Reply: VideoObject[] }>('/api/videos', async (request, reply) => {
  // TODO: Implement actual video fetching from database
  // For now, return empty array
  return [];
});

// Example single video endpoint
fastify.get<{ Params: { id: string }; Reply: VideoObject | null }>(
  '/api/videos/:id',
  async (request, reply) => {
    const { id } = request.params;
    // TODO: Fetch video by ID from database
    reply.code(404);
    return null;
  }
);

// Start server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`✅ API server running on http://localhost:${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
