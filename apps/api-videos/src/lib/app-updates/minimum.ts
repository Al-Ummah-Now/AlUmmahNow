/**
 * The minimum-version rule (wiki AUN-APP-UPDATES §3.4, §3.7): an admin may not require a version that some
 * install source of that app and platform can't give users yet. Checked when the `versions` document is saved;
 * the editor shows each problem under its field.
 *
 * Only what the server knows counts: signed releases of repos whose keys are set up, published releases of repos
 * with no root key yet (§5.5; their builds get a fixed download link), never an unsigned release of any other repo
 * and never a latest version typed into the document, Apple's own App Store lookup, and the admin's Available marks
 * for TestFlight and Amazon. A stable policy looks at stable releases only; a `#beta` policy at beta and stable.
 * Play and the Microsoft Store are confirmed on the device, so the release itself must reach the minimum.
 */
import { APP_CONFIG_PLATFORMS, compareAppVersions, type AppReleaseRepo } from '@al-ummah/shared-types';
import type { AvailabilityDocument } from './answer';
import { appStoreBundleFor, type ReleaseEntry, type ReleasesDocument } from './releases';

export interface MinimumProblem {
	key: string;
	field: 'minimumVersion';
	message: string;
	/** What is wrong, for the editor to say in the admin's language */
	code: MinimumCode;
	params: Record<string, string>;
}

export type MinimumCode = 'minimum_signed_release' | 'minimum_published_release' | 'minimum_store_none' | 'minimum_store' | 'minimum_not_marked' | 'minimum_unknown';
type Problem = Pick<MinimumProblem, 'message' | 'code' | 'params'>;

const newestName = (e: ReleaseEntry) => (e.signed ? 'The newest signed release' : 'The newest published release');
const below = (version: string, minimum: string) => compareAppVersions(version, minimum) < 0;

function releasesFor(app: string, platform: string, channels: readonly string[], releases: ReleasesDocument, noKeys: ReadonlySet<AppReleaseRepo>): ReleaseEntry[] {
	return channels
		.map((c) => releases.entries[`${app}/${platform}/${c}`])
		.filter((e): e is ReleaseEntry => !!e && (e.signed ? !!releases.keys[e.repo] : noKeys.has(e.repo)));
}

/** What a pair's install sources can give users now, and what each one lacks. */
function checkPair(app: string, platform: string, minimum: string, channels: readonly string[], releases: ReleasesDocument, availability: AvailabilityDocument, noKeys: ReadonlySet<AppReleaseRepo>): { known: boolean; problems: Problem[] } {
	const problems: Problem[] = [];
	const release = (e: ReleaseEntry): Problem => ({ message: `${newestName(e)} (${platform}) is ${e.version}, below ${minimum}.`, code: e.signed ? 'minimum_signed_release' : 'minimum_published_release', params: { platform, version: e.version, minimum } });
	let known = false;
	const signed = releasesFor(app, platform, channels, releases, noKeys);
	const newest = signed.reduce<ReleaseEntry | null>((a, b) => (!a || compareAppVersions(b.version, a.version) > 0 ? b : a), null);
	const stores = new Set(signed.flatMap((e) => e.stores));
	const bundle = appStoreBundleFor(app as never, platform as never);
	if (bundle) stores.add('appstore');

	if (newest && (newest.artifacts.length || !newest.signed)) {
		known = true;
		if (below(newest.version, minimum)) problems.push(release(newest));
	}
	for (const source of stores) {
		if (source === 'appstore') {
			const live = bundle ? releases.appStore[bundle] : undefined;
			if (!live) problems.push({ message: `The App Store has no version of this app (${platform}) yet.`, code: 'minimum_store_none', params: { platform, store: 'App Store' } });
			else {
				known = true;
				if (below(live.version, minimum)) problems.push({ message: `The App Store (${platform}) offers ${live.version}, below ${minimum}.`, code: 'minimum_store', params: { platform, store: 'App Store', version: live.version, minimum } });
			}
		} else if (source === 'testflight' || source === 'amazon') {
			const name = source === 'testflight' ? 'TestFlight' : 'Amazon Appstore';
			const marked = availability[`${app}/${platform}/${source}`];
			if (!marked) problems.push({ message: `No ${name} build (${platform}) is marked available yet.`, code: 'minimum_not_marked', params: { platform, store: name } });
			else {
				known = true;
				if (below(marked, minimum)) problems.push({ message: `${name} (${platform}) offers ${marked}, below ${minimum}.`, code: 'minimum_store', params: { platform, store: name, version: marked, minimum } });
			}
		} else if (newest) {
			// Play and the Microsoft Store: the device confirms; the release must reach the minimum
			known = true;
			if (below(newest.version, minimum) && !problems.some((p) => p.code === 'minimum_signed_release' || p.code === 'minimum_published_release')) problems.push(release(newest));
		}
	}
	return { known, problems };
}

export function minimumProblems(doc: Record<string, { minimumVersion: string }>, releases: ReleasesDocument, availability: AvailabilityDocument, noKeys: ReadonlySet<AppReleaseRepo> = new Set()): MinimumProblem[] {
	const problems: MinimumProblem[] = [];
	for (const [key, policy] of Object.entries(doc)) {
		if (compareAppVersions(policy.minimumVersion, '0.0.0') <= 0) continue;
		const [app, rest] = key.split('/');
		const [platform, channel] = rest.split('#');
		const channels = channel === 'beta' ? ['beta', 'stable'] : ['stable'];
		const platforms =
			platform === '*'
				? APP_CONFIG_PLATFORMS.filter((p) => releasesFor(app, p, channels, releases, noKeys).length || appStoreBundleFor(app as never, p))
				: [platform];
		let known = false;
		for (const p of platforms) {
			const r = checkPair(app, p, policy.minimumVersion, channels, releases, availability, noKeys);
			known ||= r.known;
			for (const p of r.problems) problems.push({ key, field: 'minimumVersion', ...p });
		}
		if (!known && !problems.some((p) => p.key === key)) problems.push({ key, field: 'minimumVersion', message: 'No release of this app is known yet, so no one could update to it.', code: 'minimum_unknown', params: {} });
	}
	return problems;
}
