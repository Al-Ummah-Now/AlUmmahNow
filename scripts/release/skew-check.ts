/**
 * Release check that skew protection works (docs/release-pipeline/SKEW-PROTECTION.md).
 *
 * Before traffic moves, promote.ts records what an open page of the version
 * serving now uses: its deployment id (data-dpl-id) and its script chunks.
 * After the new version serves 100%, those chunks must still load with
 * `?dpl=<old id>`, as an open page would ask for them: served by the old
 * version through skew protection. Without it, a chunk that only the old build
 * had answers 404 and the page breaks on its next navigation.
 */
import type { CheckResult } from './smoke.ts';

export interface BuildSnapshot {
	app: string;
	url: string;
	deploymentId: string | null;
	chunks: string[];
}

/** The deployment id and script chunks of a served page. */
export function parseBuild(html: string): { deploymentId: string | null; chunks: string[] } {
	const deploymentId = html.match(/data-dpl-id="([^"]+)"/)?.[1] ?? null;
	const chunks = [...new Set([...html.matchAll(/(\/_next\/static\/chunks\/[\w./[\]%-]+\.js)/g)].map((m) => m[1]))];
	return { deploymentId, chunks };
}

type Fetch = typeof fetch;
const UA = { 'User-Agent': 'al-ummah-now-release' };

export async function captureBuild(app: string, url: string, fetchImpl: Fetch = fetch): Promise<BuildSnapshot> {
	const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
	const html = await res.text();
	return { app, url, ...parseBuild(html) };
}

/** Checks one snapshot after the promote. At most `limit` chunks are fetched. */
export async function checkOldBuildServed(before: BuildSnapshot, fetchImpl: Fetch = fetch, limit = 8): Promise<CheckResult> {
	const name = `skew protection (${before.app})`;
	if (!before.deploymentId) {
		return { name, ok: true, detail: 'the previous build has no deployment id (built before skew protection); nothing to check' };
	}
	if (before.chunks.length === 0) return { name, ok: false, detail: `no script chunks found on ${before.url} before the promote` };
	const origin = new URL(before.url).origin;
	let onlyOld = 0;
	for (const chunk of before.chunks.slice(0, limit)) {
		const withDpl = await fetchImpl(`${origin}${chunk}?dpl=${encodeURIComponent(before.deploymentId)}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
		await withDpl.body?.cancel();
		if (withDpl.status !== 200) {
			return { name, ok: false, detail: `${chunk}?dpl=${before.deploymentId} answered ${withDpl.status}: pages opened before the promote would break` };
		}
		const plain = await fetchImpl(`${origin}${chunk}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
		await plain.body?.cancel();
		if (plain.status === 404) onlyOld++;
	}
	return {
		name,
		ok: true,
		detail: `old build ${before.deploymentId}: ${Math.min(limit, before.chunks.length)} chunk(s) served, ${onlyOld} of them only through skew protection`,
	};
}
