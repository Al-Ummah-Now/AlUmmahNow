/**
 * Release smoke for apps/status (public status page, docs/status-page/README.md), run right
 * after its `wrangler deploy` in release.yml (and by hand against QA):
 *
 *   node --experimental-strip-types scripts/release/status-smoke.ts --env qa|stage|production
 *
 * Read-only GETs on status[.<env>].alummahnow.net: /healthz (Worker + its D1), the page in
 * English and Arabic, the JSON (every component listed) and the Atom feed.
 *
 * A custom domain attached by this very deploy (the first release of an env) needs a few minutes
 * before its DNS and certificate serve: v2026.11.13.5's stage smoke failed with `fetch failed`
 * while status.stage was still coming up. So the smoke first waits up to ~3 min for the host to
 * answer at all. If it never does, nothing is checked: the run ends with a warning (exit 0), since
 * the Worker was deployed and the domain is Cloudflare's to bring up. Any HTTP answer that is
 * wrong still fails, and the workflow then rolls the status Worker back.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_STATUS_COMPONENT_IDS, STATUS_COMPONENT_IDS } from '../../packages/shared-types/src/status-page.ts';

export type StatusSmokeEnv = 'qa' | 'stage' | 'production';

export const STATUS_HOSTS: Record<StatusSmokeEnv, string> = {
	production: 'https://status.alummahnow.net',
	stage: 'https://status.stage.alummahnow.net',
	qa: 'https://status.qa.alummahnow.net',
};
export const STATUS_WORKERS: Record<'stage' | 'production', string> = { production: 'al-ummah-status', stage: 'al-ummah-status-stage' };
/** Components the public page lists (the public ones of packages/shared-types status-page.ts). */
export const COMPONENT_COUNT = PUBLIC_STATUS_COMPONENT_IDS.length;
/** Internal components (staff tools, back ends): never on the public page or JSON. */
export const INTERNAL_IDS = STATUS_COMPONENT_IDS.filter((id) => !PUBLIC_STATUS_COMPONENT_IDS.includes(id));

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

export interface SmokeDeps {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	/** Retries per check once the host answers (default 3) */
	attempts?: number;
	/** Tries, 9 s apart, waiting for the host to answer at all (default 20, ~3 min) */
	reachAttempts?: number;
}

export interface SmokeReport {
	/** The host never answered (DNS / certificate of a new custom domain not live yet): nothing was checked */
	unreachable: boolean;
	results: SmokeResult[];
}

/** Waits until the host gives any HTTP answer; false when it never does (network errors only). */
export async function waitForHost(url: string, deps: SmokeDeps): Promise<{ reached: boolean; last: string }> {
	const tries = deps.reachAttempts ?? 20;
	let last = '';
	for (let i = 0; i < tries; i++) {
		try {
			const res = await deps.fetch(url, { headers: { 'user-agent': 'al-ummah-now-release-smoke' }, redirect: 'manual' });
			await res.body?.cancel();
			return { reached: true, last: `HTTP ${res.status}` };
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (i < tries - 1) await deps.sleep(9_000);
	}
	return { reached: false, last };
}

export async function statusSmoke(env: StatusSmokeEnv, deps: SmokeDeps): Promise<SmokeReport> {
	const base = STATUS_HOSTS[env];
	const reach = await waitForHost(`${base}/healthz`, deps);
	if (!reach.reached) return { unreachable: true, results: [{ name: `${base} answers`, ok: false, detail: reach.last }] };
	const attempts = deps.attempts ?? 3;
	const out: SmokeResult[] = [];
	const check = async (name: string, path: string, verify: (res: Response, body: string) => string) => {
		let last = '';
		for (let i = 0; i < attempts; i++) {
			try {
				const res = await deps.fetch(`${base}${path}`, { headers: { 'user-agent': 'al-ummah-now-release-smoke' }, redirect: 'manual' });
				const body = await res.text();
				out.push({ name, ok: true, detail: verify(res, body) });
				return;
			} catch (error) {
				last = error instanceof Error ? error.message : String(error);
			}
			if (i < attempts - 1) await deps.sleep(9_000);
		}
		out.push({ name, ok: false, detail: last });
	};
	const need = (cond: unknown, msg: string) => {
		if (!cond) throw new Error(msg);
	};
	await check('healthz (Worker + D1)', '/healthz', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		const j = JSON.parse(body) as { status?: string; environment?: string };
		need(j.status === 'ok', `status ${j.status}`);
		return `ok (${j.environment})`;
	});
	await check('page (en)', '/', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		need(body.includes('<html lang="en" dir="ltr">'), 'not the English page');
		need((body.match(/data-component="/g) ?? []).length === COMPONENT_COUNT, 'components missing');
		const leaked = INTERNAL_IDS.filter((id) => body.includes(`data-component="${id}"`));
		need(!leaked.length, `internal components shown: ${leaked.join(', ')}`);
		return 'HTTP 200';
	});
	await check('page (ar, rtl)', '/ar', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		need(body.includes('<html lang="ar" dir="rtl">'), 'not the Arabic page');
		return 'HTTP 200';
	});
	await check('JSON', '/api/status.json', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		const j = JSON.parse(body) as { components?: { id?: string }[]; overall?: string };
		need(j.components?.length === COMPONENT_COUNT, `components ${j.components?.length}`);
		const leaked = (j.components ?? []).map((c) => c.id ?? '').filter((id) => INTERNAL_IDS.includes(id as never));
		need(!leaked.length, `internal components in JSON: ${leaked.join(', ')}`);
		return `overall ${j.overall}`;
	});
	await check('Atom feed', '/feed.atom', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		need(body.includes('<feed xmlns="http://www.w3.org/2005/Atom"'), 'not an Atom feed');
		return 'HTTP 200';
	});
	return { unreachable: false, results: out };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as StatusSmokeEnv;
	if (!(env in STATUS_HOSTS)) {
		process.stderr.write('usage: status-smoke.ts --env qa|stage|production\n');
		process.exit(2);
	}
	statusSmoke(env, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }).then(({ unreachable, results }) => {
		if (unreachable) {
			const msg = `${STATUS_HOSTS[env]} did not answer in ~3 min (${results[0].detail}); a newly attached custom domain can take longer. The Worker is deployed; smoke skipped.`;
			console.log(`::warning::status page smoke (${env}) skipped: ${msg}`);
			return;
		}
		for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
		if (results.some((r) => !r.ok)) {
			console.error(`::error::status page smoke (${env}) failed`);
			process.exit(1);
		}
	});
}
