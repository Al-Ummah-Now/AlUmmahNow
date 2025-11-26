import { Hono } from 'hono';
import moderationRouter from './moderation.router';

export function registerAllRouters(app: Hono) {
  // Register moderation router
  app.route('/', moderationRouter);

  // Add more routers here as needed
  // app.route('/', usersRouter);
  // app.route('/', analyticsRouter);
}
