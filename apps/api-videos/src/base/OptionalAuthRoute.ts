import { ValidatedRoute } from './ValidatedRoute';
import { AppContext, AuthContext } from './types';

/**
 * Base class for API endpoints that work with OR without authentication.
 *
 * These endpoints provide different functionality based on whether the user
 * is authenticated. For example, a video list might show private videos
 * for authenticated users but only public videos for guests.
 *
 * @example
 * ```typescript
 * export class VideoList extends OptionalAuthRoute {
 *   schema = {
 *     tags: ["Videos"],
 *     summary: "List videos",
 *     // ... schema definition
 *   };
 *
 *   async handle(c: AppContext) {
 *     const userId = this.getUserId(c); // May be undefined
 *
 *     if (this.isAuthenticated(c)) {
 *       // Show private videos for authenticated user
 *       return this.getVideosForUser(userId!);
 *     } else {
 *       // Show only public videos
 *       return this.getPublicVideos();
 *     }
 *   }
 * }
 * ```
 */
export abstract class OptionalAuthRoute extends ValidatedRoute {
  /**
   * Get the authentication context if present.
   *
   * @param c - Request context
   * @returns Auth context if user is authenticated, undefined otherwise
   */
  protected getAuth(c: AppContext): AuthContext | undefined {
    return c.get('auth');
  }

  /**
   * Get the user ID if authenticated.
   *
   * @param c - Request context
   * @returns User ID if authenticated, undefined otherwise
   */
  protected getUserId(c: AppContext): string | undefined {
    return this.getAuth(c)?.userId;
  }

  /**
   * Check if the request is authenticated.
   * Convenient boolean helper for conditional logic.
   *
   * @param c - Request context
   * @returns True if user is authenticated, false otherwise
   */
  protected isAuthenticated(c: AppContext): boolean {
    return this.getAuth(c) !== undefined;
  }
}
