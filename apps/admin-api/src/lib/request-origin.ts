/**
 * The origin of an admin-api request (shared-types request-origin.ts): the native Admin app says
 * so in X-AUN-Client; admin-web calls on behalf of an admin's browser and forwards its hints
 * (X-Client-User-Agent, X-Client-Mobile, X-Client-Country), which win over admin-web's own server
 * request. Only authenticated staff reach admin-api, so a forged hint can only mislabel one's own
 * actions. No IP, UA text or URL is kept.
 */
import { requestOriginFor, type RequestOrigin } from '@al-ummah/shared-types';
import { currentRequestOrigin } from '@al-ummah/shared-types/error-trail';
import { browserOrigin } from '../endpoints/errors/ErrorsIngest';

export function adminRequestOrigin(request: Request, env: unknown): RequestOrigin | undefined {
  const h = request.headers;
  if (h.get('X-Client-User-Agent') && !h.get('X-API-Key')) {
    const viaAdminWeb = browserOrigin((name) => (name === 'X-Report-App' ? 'admin-web' : h.get(name) ?? undefined));
    if (viaAdminWeb) return { ...viaAdminWeb, entry: undefined } as RequestOrigin;
  }
  return requestOriginFor('admin-api', request, env as never);
}

/**
 * The acting request's origin for an audit row's `origin` column (admin-api migration 0041):
 * surface, app, version, device and country only. Null outside a request (crons, queue jobs that
 * carry none).
 */
export function auditOriginJson(): string | null {
  const o = currentRequestOrigin();
  if (!o) return null;
  const kept = Object.fromEntries(Object.entries({ surface: o.surface, app: o.app, appVersion: o.appVersion, device: o.device, country: o.country }).filter(([, v]) => v));
  return JSON.stringify(kept);
}
