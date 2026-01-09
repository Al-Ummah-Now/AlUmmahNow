/**
 * Local Development Logging Service
 *
 * This service runs ONLY in local development and:
 * - Receives log messages via HTTP from all apps
 * - Writes logs to separate files based on app name
 * - Provides a simple HTTP API for logging with OpenAPI documentation
 *
 * NOT deployed to production - only for local development
 */

import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { HealthCheck } from './endpoints/healthCheck';
import { LogEntry } from './endpoints/logEntry';
import { BatchLogEntry } from './endpoints/batchLogEntry';
import { ListLogFiles } from './endpoints/listLogFiles';
import { GetLogs } from './endpoints/getLogs';
import { StreamLogs } from './endpoints/streamLogs';
import { StreamLogsRealtime } from './endpoints/streamLogsRealtime';

// Log directory (relative to monorepo root)
export const LOG_DIR = join(process.cwd(), '../../logs');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true });
}

// Start a Hono app
const app = new Hono();

// CORS middleware for local development
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: '/',
  schema: {
    info: {
      title: 'Al Ummah Now - Log Service API',
      version: '1.0.0',
      description: 'Development-only logging service for receiving logs via HTTP and providing log access',
    },
    servers: [
      {
        url: 'http://localhost:3089',
        description: 'Local development server',
      },
    ],
  },
});

// Register OpenAPI endpoints
openapi.get('/health', HealthCheck);
openapi.post('/log', LogEntry);
openapi.post('/log/batch', BatchLogEntry);
openapi.get('/logs', ListLogFiles);
openapi.get('/logs/stream', StreamLogs);
openapi.get('/logs/stream/realtime', StreamLogsRealtime);
openapi.get('/logs/:appName', GetLogs);

// Serve static files (log viewer HTML)
app.use('/viewer', serveStatic({ root: './public' }));

const PORT = 3089;

console.log(`📝 Log Service starting on http://localhost:${PORT}`);
console.log(`📂 Writing logs to: ${LOG_DIR}`);
console.log(`📖 API Docs available at: http://localhost:${PORT}/`);
console.log(`📄 OpenAPI spec at: http://localhost:${PORT}/openapi.json`);
console.log(`🖥️  Log Viewer at: http://localhost:${PORT}/viewer/viewer.html`);

// Start Node.js HTTP server
serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`✅ Log Service running on http://localhost:${info.port}`);
  console.log(`   📖 Docs: http://localhost:${info.port}/`);
});
