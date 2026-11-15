/**
 * Release smoke for apps/media (R2 video delivery, epic #687), run right after its
 * `wrangler deploy` in release.yml:
 *
 *   node --experimental-strip-types scripts/release/media-smoke.ts --env stage|production
 *
 *   - /priv/* answers 403 for a bad token: the Worker owns the private path (a 404 from
 *     R2 here would mean the route is gone and private renditions are not protected)
 *   - the public host answers (R2 custom domain): a missing /pub/ key is a plain 404
 *   - the transcoder Containers application exists and is not failed
 *   - a real container starts on the image just deployed, within START_LIMIT_MS (GET /priv/_selftest,
 *     asked for a run after this smoke began; polled while the rollout replaces instances). 2026-11-15:
 *     an image missing /app/review.mjs crashed at every start for a day and nothing failed
 * Exits 1 with every failure listed; the workflow then rolls the media Worker back.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createCfClient, type CfClient } from './cf-api.ts';

export type MediaEnv = 'stage' | 'production';

export const MEDIA_HOSTS: Record<MediaEnv, string> = { production: 'media.alummahnow.net', stage: 'media.stage.alummahnow.net' };
export const MEDIA_WORKERS: Record<MediaEnv, string> = { production: 'al-ummah-now-media', stage: 'al-ummah-now-media-stage' };

const VID = '00000000-0000-4000-8000-000000000000';
const REV = 'aaaaaaaaaaaaaaaa';

/** A cold start slower than this fails the smoke (apps/media jobs.ts SELFTEST_START_LIMIT_MS). */
export const START_LIMIT_MS = 60_000;
/** How long the smoke waits for the rollout to give it a container that starts. */
export const SELFTEST_WAIT_MS = 5 * 60_000;
const SELFTEST_POLL_MS = 20_000;

interface SelfTest {
	ok: boolean;
	startMs: number;
	at: string;
	error?: string;
	cached?: boolean;
	skipped?: string;
}

/**
 * The verdict on one self-test answer: pass, fail now, or ask again (a stored run from before the
 * deploy, or a start that failed while the rollout is still replacing instances).
 */
export function selfTestVerdict(r: SelfTest | null, since: number, waitedMs: number): { done: true; ok: boolean; detail: string } | { done: false } {
	const late = waitedMs >= SELFTEST_WAIT_MS;
	if (!r) return late ? { done: true, ok: false, detail: 'no answer from /priv/_selftest' } : { done: false };
	if (Date.parse(r.at) < since) return late ? { done: true, ok: false, detail: `only an older run (${r.at})` } : { done: false };
	if (r.skipped) return { done: true, ok: true, detail: `not tested: ${r.skipped}` };
	if (!r.ok) return late ? { done: true, ok: false, detail: `the container did not start: ${r.error ?? 'unknown'}` } : { done: false };
	if (r.startMs > START_LIMIT_MS) return { done: true, ok: false, detail: `cold start took ${r.startMs} ms (limit ${START_LIMIT_MS})` };
	return { done: true, ok: true, detail: `started in ${r.startMs} ms` };
}

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

export async function mediaSmoke(
	env: MediaEnv,
	deps: { fetch: typeof fetch; cf: Pick<CfClient, 'request'>; sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<SmokeResult[]> {
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const now = deps.now ?? Date.now;
	const since = now();
	const host = MEDIA_HOSTS[env];
	const out: SmokeResult[] = [];
	const check = async (name: string, fn: () => Promise<string>) => {
		try {
			out.push({ name, ok: true, detail: await fn() });
		} catch (error) {
			out.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
		}
	};
	await check('private path is the Worker (bad token → 403)', async () => {
		const res = await deps.fetch(`https://${host}/priv/1999999999.${'A'.repeat(32)}/${VID}/${REV}/master.m3u8`, { redirect: 'manual' });
		if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
		return '403';
	});
	await check('public host serves (missing key → 404)', async () => {
		const res = await deps.fetch(`https://${host}/pub/${VID}/${REV}/master.m3u8`, { redirect: 'manual' });
		if (res.status !== 404) throw new Error(`expected 404 from R2, got ${res.status}`);
		return '404';
	});
	await check('transcoder container application', async () => {
		const apps = await deps.cf.request<{ name: string; state?: string; health?: unknown }[]>('GET', '/containers/applications');
		// wrangler names it <worker>-transcoder, plus -<env> under a named env (…-stage-transcoder-stage)
		const name = `${MEDIA_WORKERS[env]}-transcoder`;
		const app = (apps ?? []).find((a) => a.name === name || a.name === `${name}-${env}`);
		if (!app) throw new Error(`${name} not found`);
		if (app.state && /fail|error/i.test(app.state)) throw new Error(`${name} is ${app.state}`);
		return `${name}${app.state ? ` (${app.state})` : ''}`;
	});
	await check('a transcoder container starts (self-test)', async () => {
		for (;;) {
			let body: SelfTest | null = null;
			try {
				const res = await deps.fetch(`https://${host}/priv/_selftest`, { redirect: 'manual' });
				body = (await res.json().catch(() => null)) as SelfTest | null;
			} catch {
				body = null;
			}
			const v = selfTestVerdict(body, since, now() - since);
			if (v.done) {
				if (!v.ok) throw new Error(v.detail);
				return v.detail;
			}
			await sleep(SELFTEST_POLL_MS);
		}
	});
	return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as MediaEnv;
	if (env !== 'stage' && env !== 'production') {
		process.stderr.write('usage: media-smoke.ts --env stage|production\n');
		process.exit(2);
	}
	mediaSmoke(env, { fetch, cf: createCfClient() }).then((results) => {
		for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
		if (results.some((r) => !r.ok)) {
			console.error(`::error::media smoke (${env}) failed`);
			process.exit(1);
		}
	});
}
