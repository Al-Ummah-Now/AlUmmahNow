/**
 * Base route classes for Admin API.
 *
 * All endpoints in admin-api require admin/moderator authentication.
 * Use AdminRoute as the base class for all endpoints.
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
 *     const userId = this.getUserId(c);
 *     // ... endpoint logic
 *   }
 * }
 * ```
 */

export { AdminRoute } from './AdminRoute';
export type { AppContext, AuthContext, AdminBindings } from './types';
