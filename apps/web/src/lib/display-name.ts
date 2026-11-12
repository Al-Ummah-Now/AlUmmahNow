import { resolveDisplayName, type NameFields } from '@al-ummah/shared-types';

/**
 * The name to show for a user (owner rule 2026-11-12: "display name should be
 * the first and last as a fallback"): resolveDisplayName from shared-types
 * (display name in `lang`, plain display name, first + last; users have no
 * handle, channels do), then
 * the API's resolvedDisplayName (public profiles carry no first/last names),
 * then `email` as the last resort. '' when there is nothing.
 */
export function userDisplayName(
  profile: (NameFields & { resolvedDisplayName?: string | null }) | null | undefined,
  lang?: string,
  email?: string | null,
): string {
  return resolveDisplayName(profile, lang)
    || (typeof profile?.resolvedDisplayName === 'string' ? profile.resolvedDisplayName.trim() : '')
    || (typeof email === 'string' ? email.trim() : '');
}
