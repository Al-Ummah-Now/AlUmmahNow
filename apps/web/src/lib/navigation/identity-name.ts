/**
 * The name the header shows for the signed-in person (the account pill, the
 * account menu, the phone sheet). Owner rule (2026-11-12): display name, else
 * first + last; issue #1673: the email is never the visible label there, not
 * even for a few frames while an identity or account switch loads.
 *
 * The session cookie carries the email as a stand-in "display name" until the
 * profile loads (lib/auth/session-manager.ts), so a candidate equal to the
 * email, or shaped like one, is skipped. '' means "no name yet": callers show
 * a neutral state (an avatar with no letter), never the email.
 */
export function identityName(candidates: ReadonlyArray<string | null | undefined>, email?: string | null): string {
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  for (const candidate of candidates) {
    const name = typeof candidate === 'string' ? candidate.trim() : '';
    if (!name || name.includes('@') || (mail && name.toLowerCase() === mail)) continue;
    return name;
  }
  return '';
}

/** The first letter of a name for a letter avatar; '' when there is no name (never the email's). */
export function identityInitial(name: string): string {
  return name ? Array.from(name)[0].toUpperCase() : '';
}

// The last name each account showed, kept across header remounts and page loads
// in this tab, so a switch paints the known name instead of a gap.
const STORAGE_KEY = 'aun-identity-names';
const known = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored(): Record<string, string> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** The last name shown for this account in this tab ('' when none). */
export function lastIdentityName(userId: string | null | undefined): string {
  if (!userId) return '';
  const cached = known.get(userId);
  if (cached) return cached;
  const stored = readStored()[userId];
  if (typeof stored === 'string' && stored) {
    known.set(userId, stored);
    return stored;
  }
  return '';
}

/** Remember the name shown for this account (names only: an email is never stored here). */
export function rememberIdentityName(userId: string | null | undefined, name: string): void {
  if (!userId || !identityName([name]) || known.get(userId) === name) return;
  known.set(userId, name);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), [userId]: name }));
  } catch {
    // Storage full or blocked: the in-memory copy still covers this page
  }
}

/** Tests only: forget every remembered name. */
export function resetIdentityNames(): void {
  known.clear();
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
