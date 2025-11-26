import { Hono } from 'hono';
import moderationRouter from './moderation.router';
import indicesRouter from './indices.router';

export function registerAllRouters(app: Hono) {
  // Register moderation router
  app.route('/', moderationRouter);

  // Register indices router
  app.route('/', indicesRouter);
}
