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

export interface RetryOptions {
	attempts: number;
	delayMs: number;
	sleep: (ms: number) => Promise<void>;
}

/**
 * The old build is reached through its version's preview URL. Right after a
 * version is uploaded that URL can answer 5xx (522) or time out for a while
 * (seen on stage when one release followed another within minutes), so a 5xx
 * or a network error is retried. Any 4xx, and above all 404 (the old chunk is
 * gone), fails at once: that is the breakage this check exists to catch.
 */
export const OLD_BUILD_RETRY: RetryOptions = { attempts: 7, delayMs: 10_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

async function fetchOldChunk(url: string, fetchImpl: Fetch, retry: RetryOptions, headers: Record<string, string>): Promise<number | string> {
	let last: number | string = 0;
	for (let attempt = 1; attempt <= retry.attempts; attempt++) {
		try {
			const res = await fetchImpl(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20_000) });
			await res.body?.cancel();
			if (res.status < 500) return res.status;
			last = res.status;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (attempt < retry.attempts) await retry.sleep(retry.delayMs);
	}
	return last;
}

/**
 * Checks one snapshot. At most `limit` chunks are fetched. `headers` reach a
 * candidate at 0% (Cloudflare-Workers-Version-Overrides) before traffic moves.
 * A 5xx that never clears is not a cold preview: a Worker's fetch to its own
 * account's workers.dev is refused (error 1042, a 522 here) unless the app sets
 * global_fetch_strictly_public (v2026.11.10.4; skew-config.ts requires it).
 */
export async function checkOldBuildServed(
	before: BuildSnapshot,
	fetchImpl: Fetch = fetch,
	limit = 8,
	retry: RetryOptions = OLD_BUILD_RETRY,
	headers: Record<string, string> = {}
): Promise<CheckResult> {
	const name = `skew protection (${before.app})`;
	if (!before.deploymentId) {
		return { name, ok: true, detail: 'the previous build has no deployment id (built before skew protection); nothing to check' };
	}
	if (before.chunks.length === 0) return { name, ok: false, detail: `no script chunks found on ${before.url} before the promote` };
	const origin = new URL(before.url).origin;
	let onlyOld = 0;
	for (const chunk of before.chunks.slice(0, limit)) {
		const status = await fetchOldChunk(`${origin}${chunk}?dpl=${encodeURIComponent(before.deploymentId)}`, fetchImpl, retry, headers);
		if (status !== 200) {
			const tries = typeof status === 'number' && status < 500 ? '' : ` (after ${retry.attempts} tries)`;
			return { name, ok: false, detail: `${chunk}?dpl=${before.deploymentId} answered ${status}${tries}: pages opened before the promote would break` };
		}
		const plain = await fetchImpl(`${origin}${chunk}`, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20_000) });
		await plain.body?.cancel();
		if (plain.status === 404) onlyOld++;
	}
	return {
		name,
		ok: true,
		detail: `old build ${before.deploymentId}: ${Math.min(limit, before.chunks.length)} chunk(s) served, ${onlyOld} of them only through skew protection`,
	};
}
