/**
 * Names saved in the videos profile reach the user's Auth record (PUT /account/name on the issuer,
 * with the user's own access token), so every app that names accounts from Auth (the account
 * switcher, profile, accounts admin, www, the CMS) follows the platform rule too: display name,
 * else first + last, else the email. Production 2026-11-13: the owner's profile had first + last
 * while Auth had no name, and every Auth-backed menu showed their email.
 */
import { logger } from './logger';

/** The name fields both stores share. */
export const NAME_KEYS = ['displayName', 'firstName', 'lastName', 'displayNameLocalized', 'firstNameLocalized', 'lastNameLocalized'] as const;

type Names = Partial<Record<(typeof NAME_KEYS)[number], unknown>>;

/** The names to send: each field as stored, an empty or missing one as null (so Auth clears it). */
export function authNamePayload(profile: Names): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of NAME_KEYS) {
    const v = profile[k];
    if (typeof v === 'string') out[k] = v.trim() || null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, s]) => typeof s === 'string' && s.trim());
      out[k] = entries.length ? Object.fromEntries(entries) : null;
    } else out[k] = null;
  }
  return out;
}

/** True when any name field differs between two profile versions. */
export function namesChanged(before: Names | null | undefined, after: Names): boolean {
  return JSON.stringify(authNamePayload(before ?? {})) !== JSON.stringify(authNamePayload(after));
}

/** The caller's bearer token from the request, or null. */
export function bearerOf(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return m ? m[1].trim() : null;
}

/**
 * Sends the profile's names to Auth. Failures are logged; the profile save never fails for it.
 * `clear: false` (a new profile) sends only the names that are set, so a name already on the Auth
 * record is never wiped by an empty new profile; an edit sends every field, so clearing one in
 * videos clears it in Auth.
 */
export async function syncNamesToAuth(
  issuer: string | undefined,
  token: string | null,
  profile: Names,
  opts: { clear?: boolean; fetcher?: typeof fetch } = {},
): Promise<boolean> {
  if (!issuer || !token) return false;
  const payload = authNamePayload(profile);
  if (opts.clear === false) for (const k of Object.keys(payload)) if (payload[k] === null) delete payload[k];
  if (!Object.keys(payload).length) return false;
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(`${issuer.replace(/\/$/, '')}/account/name`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    logger.warn('[auth-name-sync] Auth did not take the names', { status: res.status });
    return false;
  }
  return true;
}
