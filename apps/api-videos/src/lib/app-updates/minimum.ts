/**
 * The minimum-version rule (wiki AUN-APP-UPDATES §3.4, §3.7): an admin may not require a version that some
 * install source of that app and platform can't give users yet. Checked when the `versions` document is saved;
 * the editor shows each problem under its field.
 *
 * Only what the server knows counts: signed releases of repos whose keys are set up (never an unsigned release, and
 * never a latest version typed into the document), Apple's own App Store lookup, and the admin's Available marks
 * for TestFlight and Amazon. A stable policy looks at stable releases only; a `#beta` policy at beta and stable.
 * Play and the Microsoft Store are confirmed on the device, so the release itself must reach the minimum.
 */
import { APP_CONFIG_PLATFORMS, compareAppVersions } from '@al-ummah/shared-types';
import type { AvailabilityDocument } from './answer';
import { appStoreBundleFor, type ReleaseEntry, type ReleasesDocument } from './releases';

export interface MinimumProblem {
	key: string;
	field: 'minimumVersion';
	message: string;
}

const below = (version: string, minimum: string) => compareAppVersions(version, minimum) < 0;

function releasesFor(app: string, platform: string, channels: readonly string[], releases: ReleasesDocument): ReleaseEntry[] {
	return channels
		.map((c) => releases.entries[`${app}/${platform}/${c}`])
		.filter((e): e is ReleaseEntry => !!e && e.signed && !!releases.keys[e.repo]);
}

/** What a pair's install sources can give users now, and what each one lacks. */
function checkPair(app: string, platform: string, minimum: string, channels: readonly string[], releases: ReleasesDocument, availability: AvailabilityDocument): { known: boolean; problems: string[] } {
	const problems: string[] = [];
	let known = false;
	const signed = releasesFor(app, platform, channels, releases);
	const newest = signed.reduce<ReleaseEntry | null>((a, b) => (!a || compareAppVersions(b.version, a.version) > 0 ? b : a), null);
	const stores = new Set(signed.flatMap((e) => e.stores));
	const bundle = appStoreBundleFor(app as never, platform as never);
	if (bundle) stores.add('appstore');

	if (newest && newest.artifacts.length) {
		known = true;
		if (below(newest.version, minimum)) problems.push(`The newest signed release (${platform}) is ${newest.version}, below ${minimum}.`);
	}
	for (const source of stores) {
		if (source === 'appstore') {
			const live = bundle ? releases.appStore[bundle] : undefined;
			if (!live) problems.push(`The App Store has no version of this app (${platform}) yet.`);
			else {
				known = true;
				if (below(live.version, minimum)) problems.push(`The App Store (${platform}) offers ${live.version}, below ${minimum}.`);
			}
		} else if (source === 'testflight' || source === 'amazon') {
			const name = source === 'testflight' ? 'TestFlight' : 'Amazon Appstore';
			const marked = availability[`${app}/${platform}/${source}`];
			if (!marked) problems.push(`No ${name} build (${platform}) is marked available yet.`);
			else {
				known = true;
				if (below(marked, minimum)) problems.push(`${name} (${platform}) offers ${marked}, below ${minimum}.`);
			}
		} else if (newest) {
			// Play and the Microsoft Store: the device confirms; the release must reach the minimum
			known = true;
			if (below(newest.version, minimum) && !problems.some((p) => p.startsWith('The newest signed release'))) problems.push(`The newest signed release (${platform}) is ${newest.version}, below ${minimum}.`);
		}
	}
	return { known, problems };
}

export function minimumProblems(doc: Record<string, { minimumVersion: string }>, releases: ReleasesDocument, availability: AvailabilityDocument): MinimumProblem[] {
	const problems: MinimumProblem[] = [];
	for (const [key, policy] of Object.entries(doc)) {
		if (compareAppVersions(policy.minimumVersion, '0.0.0') <= 0) continue;
		const [app, rest] = key.split('/');
		const [platform, channel] = rest.split('#');
		const channels = channel === 'beta' ? ['beta', 'stable'] : ['stable'];
		const platforms =
			platform === '*'
				? APP_CONFIG_PLATFORMS.filter((p) => releasesFor(app, p, channels, releases).length || appStoreBundleFor(app as never, p))
				: [platform];
		let known = false;
		for (const p of platforms) {
			const r = checkPair(app, p, policy.minimumVersion, channels, releases, availability);
			known ||= r.known;
			for (const message of r.problems) problems.push({ key, field: 'minimumVersion', message });
		}
		if (!known && !problems.some((p) => p.key === key)) problems.push({ key, field: 'minimumVersion', message: 'No release of this app is known yet, so no one could update to it.' });
	}
	return problems;
}
