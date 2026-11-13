/**
 * First-run guides the viewer has seen, kept on their profile record so a guide shows once per
 * account, not once per browser (docs/features/HELP-AND-TOUR.md).
 *
 * `identityTour`: the highest version of the "acting as yourself or a channel" tour the viewer
 * finished or skipped (0 = never). The web shows the tour when its own version is higher, so a
 * bigger change to the tour bumps the version and shows it once more. The value only grows: an
 * older client can't make a newer tour show again. The profile view (transformProfileToView) is an
 * allowlist, so this never reaches public reads.
 */
import R2Repository from './r2Repo';

export interface OnboardingState {
	identityTour: number;
}

interface ProfileWithOnboarding {
	id: string;
	onboarding?: Partial<OnboardingState>;
	dateModified?: string;
	[key: string]: unknown;
}

const version = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);

export function onboardingOf(profile: { onboarding?: Partial<OnboardingState> } | null | undefined): OnboardingState {
	return { identityTour: version(profile?.onboarding?.identityTour) };
}

export async function getOnboarding(profiles: R2Bucket | undefined, userId: string): Promise<OnboardingState> {
	if (!profiles) return { identityTour: 0 };
	return onboardingOf(await new R2Repository<ProfileWithOnboarding>(profiles).getObject(userId));
}

export async function markOnboarding(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	seen: Partial<OnboardingState>,
): Promise<OnboardingState> {
	const now = new Date().toISOString();
	const updated = await new R2Repository<ProfileWithOnboarding>(profiles).updateObject(
		userId,
		(profile) => {
			const current = onboardingOf(profile);
			const next = { identityTour: Math.max(current.identityTour, version(seen.identityTour)) };
			if (next.identityTour === current.identityTour) return false;
			profile.onboarding = next;
			profile.dateModified = now;
			return true;
		},
		{
			initial: () => ({
				id: userId,
				email: email || 'unknown',
				dateCreated: now,
				dateModified: now,
				channels: [],
				subscribedTo: [],
			}),
		},
	);
	return onboardingOf(updated);
}
