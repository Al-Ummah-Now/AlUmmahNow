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

/**
 * The profile in an API answer: `{ success, result: { profile } }`, `{ profile }` or the profile itself
 * (which may have no email). Null when there is none.
 */
export function unwrapProfile(response: unknown): Profile | null {
    if (!response || typeof response !== 'object') return null;
    const body = response as Record<string, unknown>;
    const result = body.result as Record<string, unknown> | null | undefined;
    const profile = result && typeof result === 'object' && 'profile' in result ? result.profile : 'profile' in body ? body.profile : 'id' in body && !('success' in body) ? body : null;
    return profile && typeof profile === 'object' ? (profile as unknown as Profile) : null;
}
