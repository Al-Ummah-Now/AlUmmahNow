import { resolveDisplayName } from '@al-ummah/shared-types';

/**
 * What an admin page calls a user: the API's resolved display name (display
 * name, else first + last), then the email; never the raw id (owner rule: admin
 * pages show names). With nothing known it returns `unknown` (pass the
 * translated "Unknown user"; the page keeps the id in a copyable detail).
 * Users have no handle (handles belong to channels). Empty and whitespace-only
 * names count as missing.
 */
export function adminUserName(user: { displayName?: string | null; email?: string | null; id?: string | null; userId?: string | null } | null | undefined, unknown = ''): string {
  return resolveDisplayName({ displayName: user?.displayName }) || user?.email?.trim() || unknown;
}
