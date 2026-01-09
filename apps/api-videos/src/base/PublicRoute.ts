import { OpenAPIRoute } from 'chanfana';

/**
 * Base class for truly public API endpoints that don't need authentication.
 *
 * This is primarily for health checks, monitoring endpoints, and other
 * infrastructure endpoints that should always be accessible.
 *
 * Using this class instead of OpenAPIRoute directly:
 * 1. Makes intent explicit (this endpoint is public)
 * 2. Provides consistency across the codebase
 * 3. Allows for future shared public endpoint functionality
 *
 * @example
 * ```typescript
 * export class HealthCheck extends PublicRoute {
 *   schema = {
 *     tags: ["Monitoring"],
 *     summary: "Health check endpoint",
 *     // ... schema definition
 *   };
 *
 *   async handle(c) {
 *     return c.json({
 *       status: "healthy",
 *       timestamp: new Date().toISOString()
 *     });
 *   }
 * }
 * ```
 */
export abstract class PublicRoute extends OpenAPIRoute {
  // Currently just a semantic wrapper around OpenAPIRoute.
  // This provides room for future shared public endpoint functionality
  // such as rate limiting, CORS headers, caching, etc.
}
