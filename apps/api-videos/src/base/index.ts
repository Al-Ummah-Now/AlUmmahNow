/**
 * Base route classes for the API.
 *
 * These classes eliminate repetitive authentication checks and make
 * endpoint intent explicit through the class hierarchy.
 *
 * ## Usage Guide
 *
 * ### AuthenticatedRoute
 * Use for endpoints that REQUIRE authentication:
 * - Creating/updating/deleting resources owned by the user
 * - Accessing private user data
 * - Any operation that must know who the user is
 *
 * Example: VideoCreate, VideoUpdate, VideoDelete, ProfileUpdate
 *
 * ### OptionalAuthRoute
 * Use for endpoints that work differently based on authentication:
 * - List endpoints that show private items for authenticated users
 * - Resource fetching that may include user-specific data
 * - Features that enhance with authentication but work without it
 *
 * Example: VideoFetch (shows private videos to owner), VideoList (filters based on auth)
 *
 * ### PublicRoute
 * Use for endpoints that never need authentication:
 * - Health checks and monitoring
 * - Public data that's always the same for everyone
 * - Infrastructure endpoints
 *
 * Example: HealthCheck, Metrics, StatusPage
 *
 * ## Migration from OpenAPIRoute
 *
 * Before:
 * ```typescript
 * export class VideoCreate extends OpenAPIRoute {
 *   async handle(c) {
 *     const auth = c.get('auth');
 *     if (!auth) {
 *       return c.json({ error: 'Unauthorized' }, 401);
 *     }
 *     const userId = auth.userId;
 *     // ... rest of logic
 *   }
 * }
 * ```
 *
 * After:
 * ```typescript
 * export class VideoCreate extends AuthenticatedRoute {
 *   async handle(c: AppContext) {
 *     const userId = this.getUserId(c); // No null check needed
 *     // ... rest of logic
 *   }
 * }
 * ```
 */

export { AuthenticatedRoute } from './AuthenticatedRoute';
export { OptionalAuthRoute } from './OptionalAuthRoute';
export { PublicRoute } from './PublicRoute';
export type { AppContext, AuthContext, AppBindings } from './types';
