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
 * Exits 1 with every failure listed; the workflow then rolls the media Worker back.
 */
import { resolve } from 'node:path';
import { createCfClient, type CfClient } from './cf-api.ts';

export type MediaEnv = 'stage' | 'production';

export const MEDIA_HOSTS: Record<MediaEnv, string> = { production: 'media.alummahnow.net', stage: 'media.stage.alummahnow.net' };
export const MEDIA_WORKERS: Record<MediaEnv, string> = { production: 'al-ummah-now-media', stage: 'al-ummah-now-media-stage' };

const VID = '00000000-0000-4000-8000-000000000000';
const REV = 'aaaaaaaaaaaaaaaa';

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

export async function mediaSmoke(env: MediaEnv, deps: { fetch: typeof fetch; cf: Pick<CfClient, 'request'> }): Promise<SmokeResult[]> {
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
	return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(decodeURIComponent(new URL(import.meta.url).pathname));
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
