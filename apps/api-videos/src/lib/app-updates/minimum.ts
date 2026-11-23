/**
 * The minimum-version rule (wiki AUN-APP-UPDATES §3.4, §3.7): an admin may not require a version that
 * some install source of that app and platform can't give users yet. Checked when the `versions`
 * document is saved; the editor shows each problem under its field.
 */
import { APP_CONFIG_PLATFORMS, compareAppVersions } from '@al-ummah/shared-types';
import type { AvailabilityDocument } from './answer';
import { appStoreBundleFor, type ReleasesDocument } from './releases';

export interface MinimumProblem {
	key: string;
	field: 'minimumVersion';
	message: string;
}

/** Every version a source of this pair is known to offer, with where it comes from. */
function offers(app: string, platform: string, releases: ReleasesDocument, availability: AvailabilityDocument, legacyLatest?: string): { source: string; version: string }[] {
	const out: { source: string; version: string }[] = [];
	for (const channel of ['stable', 'beta']) {
		const e = releases.entries[`${app}/${platform}/${channel}`];
		if (e) out.push({ source: `release ${e.tag}${e.signed ? '' : ' (unsigned)'}`, version: e.version });
	}
	const bundle = appStoreBundleFor(app as never, platform as never);
	if (bundle && releases.appStore[bundle]) out.push({ source: 'App Store', version: releases.appStore[bundle].version });
	for (const source of ['testflight', 'amazon']) {
		const v = availability[`${app}/${platform}/${source}`];
		if (v) out.push({ source: source === 'testflight' ? 'TestFlight' : 'Amazon Appstore', version: v });
	}
	if (legacyLatest) out.push({ source: 'latest version on this entry', version: legacyLatest });
	return out;
}

/**
 * Problems with the minimums of a `versions` document: a minimum above 0.0.0 needs at least one known
 * release of the pair, and must not be above the App Store's version, a TestFlight or Amazon mark, or
 * the newest release (for `<app>/*`, of every platform that has one).
 */
export function minimumProblems(doc: Record<string, { minimumVersion: string; latestVersion?: string }>, releases: ReleasesDocument, availability: AvailabilityDocument): MinimumProblem[] {
	const problems: MinimumProblem[] = [];
	for (const [key, policy] of Object.entries(doc)) {
		if (compareAppVersions(policy.minimumVersion, '0.0.0') <= 0) continue;
		const [app, rest] = key.split('/');
		const platform = rest.split('#')[0];
		const platforms = platform === '*' ? APP_CONFIG_PLATFORMS.filter((p) => offers(app, p, releases, availability).length) : [platform];
		const all = platforms.flatMap((p) => offers(app, p, releases, availability, policy.latestVersion).map((o) => ({ ...o, platform: p })));
		if (!all.length) {
			problems.push({ key, field: 'minimumVersion', message: 'No release of this app is known yet, so no one could update to it.' });
			continue;
		}
		// The store entries must each reach the minimum; the newest release is the ceiling
		const short = all.filter((o) => !o.source.startsWith('release ') && o.source !== 'latest version on this entry' && compareAppVersions(o.version, policy.minimumVersion) < 0);
		for (const o of short) problems.push({ key, field: 'minimumVersion', message: `${o.source} (${o.platform}) offers ${o.version}, below ${policy.minimumVersion}.` });
		const newest = all.reduce((a, b) => (compareAppVersions(a.version, b.version) >= 0 ? a : b));
		if (compareAppVersions(newest.version, policy.minimumVersion) < 0) problems.push({ key, field: 'minimumVersion', message: `The newest known version is ${newest.version} (${newest.source}), below ${policy.minimumVersion}.` });
	}
	return problems;
}
