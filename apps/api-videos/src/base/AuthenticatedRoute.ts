import { OpenAPIRoute } from 'chanfana';
import { HTTPException } from 'hono/http-exception';
import { AppContext, AuthContext } from './types';
import { logger } from '../lib/logger';

/**
 * Base class for API endpoints that REQUIRE authentication.
 *
 * This class automatically validates that a user is authenticated before
 * calling the endpoint's handler. Eliminates repetitive auth checks.
 *
 * @example
 * ```typescript
 * export class VideoCreate extends AuthenticatedRoute {
 *   schema = {
 *     tags: ["Videos"],
 *     summary: "Create a new video",
 *     // ... schema definition
 *   };
 *
 *   async handle(c: AppContext) {
 *     const userId = this.getUserId(c); // Always valid
 *     const auth = this.getAuth(c);     // Always valid
 *
 *     // Your endpoint logic here
 *   }
 * }
 * ```
 */
export abstract class AuthenticatedRoute extends OpenAPIRoute {
  /**
   * Executes the endpoint with authentication validation.
   * Overrides the base execute() to check auth before calling handle().
   *
   * @throws {HTTPException} 401 if authentication is missing or invalid
   */
  async execute(...args: any[]): Promise<Response> {
    const c = args[0] as AppContext;

    // Validate authentication
    const auth = c.get('auth');
    if (!auth) {
      logger.warn('[AuthenticatedRoute] Authentication required but not present', {
        path: c.req.path,
        method: c.req.method
      });

      throw new HTTPException(401, {
        message: 'Authentication required'
      });
    }

    // Authentication valid, proceed with normal execution
    logger.debug('[AuthenticatedRoute] Authentication validated', {
      userId: auth.userId,
      path: c.req.path
    });

    return super.execute(...args);
  }

  /**
   * Get the authenticated user's context.
   * Safe to call without null checks since auth is guaranteed by execute().
   *
   * @param c - Request context
   * @returns Auth context with user ID, email, and JWT payload
   */
  protected getAuth(c: AppContext): AuthContext {
    const auth = c.get('auth');
    if (!auth) {
      // This should never happen due to execute() validation
      // But TypeScript doesn't know that, so we handle it
      throw new HTTPException(401, {
        message: 'Authentication required'
      });
    }
    return auth;
  }

  /**
   * Get the authenticated user's ID.
   * Convenience method for the most common auth operation.
   *
   * @param c - Request context
   * @returns User ID from JWT token
   */
  protected getUserId(c: AppContext): string {
    return this.getAuth(c).userId;
  }
}
