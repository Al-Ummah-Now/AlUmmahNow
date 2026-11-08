import { OpenAPIRoute } from 'chanfana';
import { HTTPException } from 'hono/http-exception';
import { AppContext, AuthContext } from './types';
import { logger } from '../lib/logger';

/**
 * Base class for API endpoints that REQUIRE admin/moderator authentication.
 *
 * This class automatically validates that a user is authenticated AND has
 * admin or moderator role before calling the endpoint's handler.
 *
 * @example
 * ```typescript
 * export class ReportsList extends AdminRoute {
 *   schema = {
 *     tags: ["Moderation"],
 *     summary: "List all reports",
 *   };
 *
 *   async handle(c: AppContext) {
 *     const userId = this.getUserId(c); // Always valid
 *     const roles = this.getRoles(c);   // Always contains admin or moderator
 *
 *     // Your endpoint logic here
 *   }
 * }
 * ```
 */
export abstract class AdminRoute extends OpenAPIRoute {
  /**
   * Executes the endpoint with authentication and admin role validation.
   */
  async execute(...args: any[]): Promise<Response> {
    const c = args[0] as AppContext;

    // Validate authentication
    const auth = c.get('auth');

    // Debug: Log what we received in auth context
    logger.info('[AdminRoute] Auth context received', {
      hasAuth: !!auth,
      authKeys: auth ? Object.keys(auth) : [],
      userId: auth?.userId,
      roles: auth?.roles,
      rolesType: auth?.roles ? typeof auth.roles : 'undefined',
      rolesIsArray: Array.isArray(auth?.roles),
      path: c.req.path,
      method: c.req.method
    });

    if (!auth) {
      logger.warn('[AdminRoute] Authentication required but not present', {
        path: c.req.path,
        method: c.req.method
      });

      throw new HTTPException(401, {
        message: 'Authentication required'
      });
    }

    // Validate admin/moderator role
    const hasAdminRole = await this.checkAdminRole(c, auth.userId);
    if (!hasAdminRole) {
      logger.warn('[AdminRoute] Admin/moderator role required but not present', {
        userId: auth.userId,
        authRoles: auth.roles,
        path: c.req.path,
        method: c.req.method
      });

      throw new HTTPException(403, {
        message: 'Admin or moderator role required'
      });
    }

    logger.debug('[AdminRoute] Admin access validated', {
      userId: auth.userId,
      path: c.req.path
    });

    return super.execute(...args);
  }

  /**
   * Check if user has admin or moderator role
   * Uses the roles already validated by the auth middleware
   */
  private async checkAdminRole(c: AppContext, userId: string): Promise<boolean> {
    try {
      // Get roles from auth context (already validated by adminMiddleware)
      const auth = c.get('auth');

      logger.info('[AdminRoute] checkAdminRole called', {
        userId,
        hasAuth: !!auth,
        authRoles: auth?.roles,
        authRolesLength: auth?.roles?.length
      });

      if (!auth) {
        logger.warn('[AdminRoute] No auth context found in checkAdminRole', { userId });
        return false;
      }

      const roles = auth.roles || [];
      const isAdmin = roles.includes('admin') || roles.includes('super_admin');
      const isModerator = roles.includes('moderator');

      logger.info('[AdminRoute] Role check result', {
        userId,
        roles,
        rolesLength: roles.length,
        isAdmin,
        isModerator,
        result: isAdmin || isModerator
      });

      return isAdmin || isModerator;
    } catch (error) {
      logger.error('Error checking admin role:', error);
      return false;
    }
  }

  /**
   * Get the authenticated user's context.
   */
  protected getAuth(c: AppContext): AuthContext {
    const auth = c.get('auth');
    if (!auth) {
      throw new HTTPException(401, {
        message: 'Authentication required'
      });
    }
    return auth;
  }

  /**
   * Get the authenticated user's ID.
   */
  protected getUserId(c: AppContext): string {
    return this.getAuth(c).userId;
  }

  /**
   * Get the authenticated user's roles.
   */
  protected getRoles(c: AppContext): string[] {
    return this.getAuth(c).roles || [];
  }

  /**
   * Check if user is an admin (not just moderator)
   */
  protected isAdmin(c: AppContext): boolean {
    const roles = this.getRoles(c);
    return roles.includes('admin') || roles.includes('super_admin');
  }

  /**
   * Check if user is a moderator (includes admins)
   */
  protected isModerator(c: AppContext): boolean {
    const roles = this.getRoles(c);
    return roles.includes('admin') || roles.includes('super_admin') || roles.includes('moderator');
  }
}
