/**
 * Release smoke for apps/status (public status page, docs/status-page/README.md), run right
 * after its `wrangler deploy` in release.yml (and by hand against QA):
 *
 *   node --experimental-strip-types scripts/release/status-smoke.ts --env qa|stage|production
 *
 * Read-only GETs on status[.<env>].alummahnow.net: /healthz (Worker + its D1), the page in
 * English and Arabic, the JSON (every component listed) and the Atom feed. A fresh custom domain
 * can take a minute to answer, so each check retries for up to ~90 s.
 * Exits 1 with every failure listed; the workflow then rolls the status Worker back.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type StatusSmokeEnv = 'qa' | 'stage' | 'production';

export const STATUS_HOSTS: Record<StatusSmokeEnv, string> = {
	production: 'https://status.alummahnow.net',
	stage: 'https://status.stage.alummahnow.net',
	qa: 'https://status.qa.alummahnow.net',
};
export const STATUS_WORKERS: Record<'stage' | 'production', string> = { production: 'al-ummah-status', stage: 'al-ummah-status-stage' };
/** Components the page must list (packages/shared-types status-page.ts STATUS_COMPONENTS). */
export const COMPONENT_COUNT = 13;

export interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

export interface SmokeDeps {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	attempts?: number;
}

export async function statusSmoke(env: StatusSmokeEnv, deps: SmokeDeps): Promise<SmokeResult[]> {
	const base = STATUS_HOSTS[env];
	const attempts = deps.attempts ?? 10;
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
		return 'HTTP 200';
	});
	await check('page (ar, rtl)', '/ar', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		need(body.includes('<html lang="ar" dir="rtl">'), 'not the Arabic page');
		return 'HTTP 200';
	});
	await check('JSON', '/api/status.json', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		const j = JSON.parse(body) as { components?: unknown[]; overall?: string };
		need(j.components?.length === COMPONENT_COUNT, `components ${j.components?.length}`);
		return `overall ${j.overall}`;
	});
	await check('Atom feed', '/feed.atom', (res, body) => {
		need(res.status === 200, `HTTP ${res.status}`);
		need(body.includes('<feed xmlns="http://www.w3.org/2005/Atom"'), 'not an Atom feed');
		return 'HTTP 200';
	});
	return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const i = process.argv.indexOf('--env');
	const env = (i >= 0 ? process.argv[i + 1] : '') as StatusSmokeEnv;
	if (!(env in STATUS_HOSTS)) {
		process.stderr.write('usage: status-smoke.ts --env qa|stage|production\n');
		process.exit(2);
	}
	statusSmoke(env, { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }).then((results) => {
		for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
		if (results.some((r) => !r.ok)) {
			console.error(`::error::status page smoke (${env}) failed`);
			process.exit(1);
		}
	});
}
