import { Profile } from "@/interfaces";

/**
 * Check if a profile is complete (non-async utility function)
 * Cannot be in profiles.ts due to 'use server' restriction
 */
export const isProfileComplete = (profile: Profile | null): boolean => {
    if (!profile) return false;

    // Business rule: By default, when a user profile is created, the firstName is set to the prefix
    // of the user's email address (the part before the '@'). A profile is only considered "complete"
    // if the user has updated their firstName to something other than the email prefix.
    // This check ensures that users personalize their profile and do not leave the default value.
    // If this business rule changes (e.g., if the default firstName is set differently),
    // this logic should be updated accordingly.
    return !!(
        profile.firstName &&
        profile.firstName.trim() !== '' &&
        profile.firstName !== profile.email?.split('@')[0]  // Not just the default email prefix
    );
};

const plainObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * The profile in an API answer: `{ success, result: { profile } }`, `{ profile }` or the profile itself
 * (which may have no email). Null for an error or a failed answer, and for anything without an id.
 */
export function unwrapProfile(response: unknown): Profile | null {
    const body = plainObject(response);
    if (!body || body.success === false || body.error) return null;
    const result = plainObject(body.result);
    const profile = plainObject(result && 'profile' in result ? result.profile : 'profile' in body ? body.profile : 'success' in body ? null : body);
    if (!profile || profile.error || typeof profile.id !== 'string' || !profile.id) return null;
    return profile as unknown as Profile;
}
