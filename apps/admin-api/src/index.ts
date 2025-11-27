import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors';
import { authMiddleware, adminMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';

// ==========================================
// APP SETUP
// ==========================================

const app = new Hono();

// Global error handler
app.onError((err, c) => {
  logger.error('Unhandled error:', err);
  return c.json({
    success: false,
    error: err.message || 'Internal server error',
  }, 500);
});

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================

// Setup CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false,
}));

// OPTIONS handler for API endpoints
app.options('/api/*', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  c.header('Access-Control-Max-Age', '600');
  c.header('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  return new Response('', { status: 204 });
});

// ==========================================
// LOGGING MIDDLEWARE
// ==========================================

// Apply logging middleware to all API routes
app.use('/api/*', loggingMiddleware);

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

// Apply auth + admin middleware to all API routes
app.use('/api/*', authMiddleware);
app.use('/api/*', adminMiddleware);

// ==========================================
// OPENAPI SETUP
// ==========================================

const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: {
      title: "Al Ummah Admin API",
      version: "1.0.0",
      description: "Admin and moderation API for Al Ummah platform. All endpoints require admin or moderator role.",
    },
    servers: [
      { url: "http://127.0.0.1:3090", description: "Local development" },
      { url: "https://admin-api.alummahnow.net", description: "Production" },
    ],
    security: [
      { bearerAuth: [] }
    ],
  },
});

// ==========================================
// REGISTER ROUTERS
// ==========================================

registerAllRouters(openapi);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'admin-api',
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// EXPORT
// ==========================================

export default app;
