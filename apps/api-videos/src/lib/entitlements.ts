/**
 * Entitlement keys declared by api-videos features (Epic 27 catalogue input).
 *
 * The plans & entitlements framework (Epic 27.1/27.2) is not implemented yet:
 * everyone is on Free, so features enforce the Free value below directly.
 * When `GET /api/entitlements` lands, endpoints resolve these keys per channel
 * instead of reading FREE_DEFAULTS.
 */

export interface EntitlementDeclaration {
	key: string;
	type: 'boolean' | 'number';
	free: boolean | number;
	story: string;
	description: string;
	atLimit: string;
}

export const ENTITLEMENTS: ReadonlyArray<EntitlementDeclaration> = [
	{ key: 'channel.handle', type: 'boolean', free: true, story: '29.1', description: 'Claim and change a channel @handle', atLimit: 'n/a (all plans)' },
	{ key: 'channel.about.links.max', type: 'number', free: 10, story: '29.1', description: 'Links on the channel About tab', atLimit: '400 validation error; settings UI stops adding rows' },
	{ key: 'comments.replies', type: 'boolean', free: true, story: '29.2', description: 'Replies (one level) on video comments', atLimit: 'n/a (all plans)' },
	{ key: 'comments.settings', type: 'boolean', free: true, story: '29.2', description: 'Per-video comment settings: on / off', atLimit: 'n/a (all plans)' },
	{ key: 'comments.heldForReview', type: 'boolean', free: true, story: '29.2', description: 'Per-video "hold comments for review" setting', atLimit: 'n/a (all plans)' },
];

export const FREE_DEFAULTS: Readonly<Record<string, boolean | number>> = Object.fromEntries(
	ENTITLEMENTS.map((e) => [e.key, e.free]),
);
