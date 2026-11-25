/**
 * Runs the release index (releases.ts) with its admin Errors reporting: a quarantined manifest or a
 * refused key list becomes one needs-action item per source and tag (wiki AUN-APP-UPDATES §3.2).
 */
import { reportNeedsAction, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { loadMobileAppsSettings, type AttestationEnv } from '../attestation/service';
import { indexReleases, type IndexResult, type ReleasesEnv } from './releases';

export async function runReleaseIndex(env: ReleasesEnv & ErrorReporterEnv & AttestationEnv, ctx: ExecutionContext | undefined, opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<IndexResult> {
	// No Team ID in Settings → Mobile apps: no app is in the App Store yet
	const { apple } = await loadMobileAppsSettings(env);
	return indexReleases(env, {
		...opts,
		appStoreBundles: apple.teamId ? apple.apps.map((a) => a.bundleId) : [],
		onProblem: (p) =>
			reportNeedsAction('api-videos', env, ctx, {
				key: `app-release:${p.source}:${p.tag}`,
				source: 'ops',
				title: p.tag === 'update-keys' ? 'App update key list refused' : 'App release quarantined',
				message: `${p.source} ${p.tag}: ${p.reason}${p.detail ? ` (${p.detail.slice(0, 300)})` : ''}. No app is told about it and nothing links to it. Check the release workflow, the signing keys and whether the release was tampered with.`,
				itemType: 'app-release',
				itemId: `${p.source}:${p.tag}`,
				extra: { source: p.source, repo: p.repo, tag: p.tag, reason: p.reason },
			}),
	});
}
