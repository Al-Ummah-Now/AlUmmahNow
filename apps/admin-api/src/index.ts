import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from 'hono/cors';
import { authMiddleware, adminMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";
import { logger } from './lib/logger';
import { registerAllRouters } from './routers';
import { publicSiteTheme } from './lib/siteSettings';
import themesRouter, { publicThemes } from './routers/themes.router';
import type { AdminBindings } from './base/types';
import { contactSubmit } from './endpoints/contact/ContactSubmit';

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

// CORS origin validation
const isAllowedOrigin = (origin: string): boolean => {
  const allowedOrigins = [
    // Production
    'https://alummahnow.net',
    'https://www.alummahnow.net',
    'https://admin.alummahnow.net',
    // Staging
    'https://staging.alummahnow.net',
    'https://admin-staging.alummahnow.net',
    // Development
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3090',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3086',
    'http://127.0.0.1:3090',
  ];
  return allowedOrigins.includes(origin);
};

// Setup CORS
app.use('*', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : '',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false,
}));

// OPTIONS handler for API endpoints
app.options('/api/*', (c) => {
  const origin = c.req.header('Origin') || '';
  const allowedOrigin = isAllowedOrigin(origin) ? origin : '';
  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin);
  }
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

// The site theme is public and read by the web apps on every page, so it is short-lived at the edge
app.get('/public/site-theme', async (c) => {
  const answer = await publicSiteTheme((c.env as AdminBindings).REPORTS_DB, new URL(c.req.url).origin);
  return c.json(answer, 200, { 'Cache-Control': 'public, max-age=30' });
});

// Contact us messages from the videos site's server (X-API-Key; endpoints/contact/ContactSubmit.ts)
app.post('/internal/contact', (c) => contactSubmit(c as never));

// Published theme packages: compiled CSS, theme.json and assets, immutable per version
app.route('/public/themes', publicThemes as never);

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

// Theme builder (zip and file bodies, so plain Hono): /api/themes
app.route('/api/themes', themesRouter as never);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'admin-api',
    // Worker version id serving this request (the release smoke checks it)
    deployment: (c.env as { CF_VERSION_METADATA?: { id: string } }).CF_VERSION_METADATA?.id ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// EXPORT
// ==========================================

export default app;
