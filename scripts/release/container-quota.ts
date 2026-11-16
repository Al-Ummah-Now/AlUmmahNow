/**
 * Container quota check, run in the release's Stage job before anything is deployed:
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node --experimental-strip-types scripts/release/container-quota.ts
 *
 * Cloudflare refuses a container deploy when the account's applications together would reserve more
 * vCPU than the account's quota (`GET /accounts/{id}/containers/me` → limits.total_vcpu; each
 * application reserves max_instances × its instance type's vCPU). v2026.11.15.3 learned this only at
 * "Deploy media (production)", after every other worker was promoted: max_instances 3750 × 4 vCPU =
 * 15,000 on top of stage's and QA's 16. This reads the quota and every application's reservation
 * (read-only) and checks the media configs this release will deploy (production, stage, QA) fit,
 * with the applications outside them as Cloudflare reports them now. Prints no secrets.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseJsonc } from './jsonc.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** vCPU per instance type (developers.cloudflare.com/containers/platform-details/limits/#instance-types). */
export const INSTANCE_VCPU: Record<string, number> = { lite: 1 / 16, dev: 1 / 16, basic: 1 / 4, standard: 1 / 2, 'standard-1': 1 / 2, 'standard-2': 1, 'standard-3': 2, 'standard-4': 4 };

export interface PlannedApp {
	/** The Worker that owns the container application (its name prefix in the API) */
	worker: string;
	maxInstances: number;
	vcpu: number;
}

export interface AccountApp {
	name: string;
	maxInstances: number;
	vcpu: number;
}

/** The media containers this checkout deploys: production and stage from wrangler.jsonc, QA from wrangler.qa.jsonc. */
export function plannedMediaApps(root = ROOT): PlannedApp[] {
	const read = (f: string) => parseJsonc(readFileSync(join(root, 'apps/media', f), 'utf8')) as any;
	const prod = read('wrangler.jsonc');
	const qa = read('wrangler.qa.jsonc');
	const one = (worker: string, cfg: any): PlannedApp => {
		const c = (cfg.containers ?? [])[0] ?? {};
		const vcpu = INSTANCE_VCPU[c.instance_type ?? 'lite'];
		if (vcpu === undefined) throw new Error(`${worker}: unknown instance_type ${c.instance_type}`);
		return { worker, maxInstances: Number(c.max_instances ?? 20), vcpu };
	};
	return [one(prod.name, prod), one(prod.env.stage.name, { ...prod, ...prod.env.stage }), one(qa.name, qa)];
}

/** Whether a Cloudflare application belongs to a planned Worker (production's name is a prefix of stage's and QA's). */
export function appOf(app: AccountApp, planned: PlannedApp[]): PlannedApp | undefined {
	const owners = planned.filter((p) => app.name.startsWith(`${p.worker}-`));
	return owners.sort((a, b) => b.worker.length - a.worker.length)[0];
}

export interface QuotaVerdict {
	ok: boolean;
	totalVcpu: number;
	planned: { worker: string; vcpu: number }[];
	others: { name: string; vcpu: number }[];
	needed: number;
	/** Largest max_instances production could have with everything else as planned */
	productionMax: number;
}

/** Planned media apps plus every other application as reserved now must fit in total_vcpu. Pure. */
export function checkQuota(totalVcpu: number, account: AccountApp[], planned: PlannedApp[]): QuotaVerdict {
	const others = account.filter((a) => !appOf(a, planned)).map((a) => ({ name: a.name, vcpu: a.maxInstances * a.vcpu }));
	const plannedVcpu = planned.map((p) => ({ worker: p.worker, vcpu: p.maxInstances * p.vcpu }));
	const sum = (xs: { vcpu: number }[]) => xs.reduce((n, x) => n + x.vcpu, 0);
	const needed = sum(plannedVcpu) + sum(others);
	const prod = planned[0]!;
	const rest = sum(plannedVcpu.slice(1)) + sum(others);
	return { ok: needed <= totalVcpu, totalVcpu, planned: plannedVcpu, others, needed, productionMax: Math.floor((totalVcpu - rest) / prod.vcpu) };
}

async function main(): Promise<void> {
	const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const get = async (path: string) => {
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { headers: { authorization: `Bearer ${token}` } });
		const body = (await res.json().catch(() => ({}))) as any;
		if (!res.ok || body.success === false) throw new Error(`GET ${path}: HTTP ${res.status} ${JSON.stringify(body.errors ?? [])}`);
		return body.result;
	};
	const me = await get('/containers/me');
	const totalVcpu = Number(me?.limits?.total_vcpu);
	if (!Number.isFinite(totalVcpu) || totalVcpu <= 0) throw new Error('containers/me has no limits.total_vcpu');
	const apps: AccountApp[] = ((await get('/containers/applications')) ?? []).map((a: any) => ({
		name: String(a.name),
		maxInstances: Number(a.max_instances ?? 0),
		vcpu: Number(a.configuration?.vcpu ?? 0),
	}));
	const planned = plannedMediaApps();
	const v = checkQuota(totalVcpu, apps, planned);
	const lines = [
		`Container vCPU quota: ${v.totalVcpu}; this release needs ${v.needed}.`,
		...v.planned.map((p) => `- ${p.worker} (planned): ${p.vcpu} vCPU`),
		...v.others.map((o) => `- ${o.name} (other application, as reserved now): ${o.vcpu} vCPU`),
		`Largest production max_instances that fits: ${v.productionMax}.`,
	];
	process.stdout.write(lines.join('\n') + '\n');
	if (!v.ok) {
		process.stdout.write(`::error::The media containers would reserve ${v.needed} vCPU, over the account's ${v.totalVcpu}: lower max_instances in apps/media/wrangler*.jsonc (production at most ${v.productionMax}).\n`);
		process.exit(1);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(`container-quota failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
