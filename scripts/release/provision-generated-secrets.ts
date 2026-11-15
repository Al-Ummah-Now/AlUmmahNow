/**
 * Creates the generated secrets of GENERATED_SECRETS (secrets-manifest.ts) in the
 * Secrets Store for each env, only when absent. Never overwrites, never prints a
 * value: output and the summary carry names and created/skipped only.
 *
 *   node --experimental-strip-types scripts/release/provision-generated-secrets.ts [--env qa|stage|production] [--dry-run]
 *
 * A group is created only when none of its secrets exist; when some but not all
 * exist (half a key pair) nothing is created and the run fails, since a new pair
 * would not match the half already bound.
 * Exit 0 = done, 1 = a group is half provisioned or a create failed, 2 = could not run.
 */
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCfClient, type CfClient } from './cf-api.ts';
import { GENERATED_SECRETS, SECRETS_STORE_ID, STORE_SUFFIX, type EnvName, type GeneratedSecret } from './secrets-manifest.ts';

const ENVS: EnvName[] = ['qa', 'stage', 'production'];

/** A VAPID pair in the `web-push generate-vapid-keys` format the processor imports. */
export function generateVapid(): Record<string, string> {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string };
	const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
	return { publicKey: point.toString('base64url'), privateKey: jwk.d };
}

export const GENERATORS: Record<GeneratedSecret['generated'], () => Record<string, string>> = { vapid: generateVapid };

export interface Deps {
	existing(storeId: string): Promise<Set<string>>;
	create(storeId: string, secrets: { name: string; value: string; scopes: string[]; comment: string }[]): Promise<void>;
	/** Hide a value from CI logs before it exists anywhere (GitHub ::add-mask::). */
	mask(value: string): void;
	generators?: typeof GENERATORS;
}

export interface Outcome {
	env: EnvName;
	names: string[];
	result: 'created' | 'skipped' | 'would create' | 'partial' | 'failed';
	detail?: string;
}

export async function provision(envs: EnvName[], deps: Deps, opts: { dryRun?: boolean; storeId?: string; groups?: GeneratedSecret[] } = {}): Promise<Outcome[]> {
	const storeId = opts.storeId ?? SECRETS_STORE_ID;
	const generators = deps.generators ?? GENERATORS;
	const present = await deps.existing(storeId);
	const out: Outcome[] = [];
	for (const env of envs) {
		for (const group of opts.groups ?? GENERATED_SECRETS) {
			const names = Object.fromEntries(Object.entries(group.names).map(([part, base]) => [part, `${base}${STORE_SUFFIX[env]}`]));
			const all = Object.values(names);
			const have = all.filter((n) => present.has(n));
			if (have.length === all.length) {
				out.push({ env, names: all, result: 'skipped', detail: 'exists' });
				continue;
			}
			if (have.length > 0) {
				out.push({ env, names: all, result: 'partial', detail: `only ${have.join(', ')} exists; not overwriting, fix by hand` });
				continue;
			}
			if (opts.dryRun) {
				out.push({ env, names: all, result: 'would create' });
				continue;
			}
			const values = generators[group.generated]();
			for (const v of Object.values(values)) deps.mask(v);
			try {
				// One request for the whole group, so a pair is never half created
				await deps.create(
					storeId,
					Object.entries(names).map(([part, name]) => ({ name, value: values[part]!, scopes: ['workers'], comment: `generated (${group.generated}) by provision-generated-secrets` })),
				);
				out.push({ env, names: all, result: 'created' });
			} catch (error) {
				out.push({ env, names: all, result: 'failed', detail: error instanceof Error ? error.message : 'create failed' });
			}
		}
	}
	return out;
}

export function cfDeps(cf: CfClient): Deps {
	return {
		async existing(storeId) {
			const names = new Set<string>();
			for (let page = 1; ; page++) {
				const list = await cf.request<{ name: string }[]>('GET', `/secrets_store/stores/${storeId}/secrets?per_page=100&page=${page}`);
				for (const s of list ?? []) names.add(s.name);
				if (!list || list.length < 100) return names;
			}
		},
		async create(storeId, secrets) {
			await cf.request('POST', `/secrets_store/stores/${storeId}/secrets`, secrets);
		},
		mask(value) {
			if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${value}\n`);
		},
	};
}

export function summary(outcomes: Outcome[]): string {
	const rows = outcomes.map((o) => `| ${o.env} | ${o.names.map((n) => `\`${n}\``).join(', ')} | ${o.result}${o.detail ? ` (${o.detail})` : ''} |`);
	return ['### Provision generated secrets', '', '| Env | Secrets | Result |', '|---|---|---|', ...rows, ''].join('\n');
}

function parse(argv: string[]): { envs: EnvName[]; dryRun: boolean } {
	let envs = ENVS;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--dry-run') dryRun = true;
		else if (argv[i] === '--env') {
			const env = argv[++i];
			if (env && env !== 'all') {
				if (!ENVS.includes(env as EnvName)) throw new Error(`Unknown env ${env}`);
				envs = [env as EnvName];
			}
		} else throw new Error(`Unknown argument ${argv[i]}`);
	}
	return { envs, dryRun };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	let args: ReturnType<typeof parse>;
	let outcomes: Outcome[];
	try {
		args = parse(process.argv.slice(2));
		outcomes = await provision(args.envs, cfDeps(createCfClient()), { dryRun: args.dryRun });
	} catch (error) {
		process.stderr.write(`Could not provision: ${error instanceof Error ? error.message : 'unknown error'}\n`);
		process.exit(2);
	}
	const text = summary(outcomes);
	process.stdout.write(`${text}\n`);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
	process.exit(outcomes.some((o) => o.result === 'partial' || o.result === 'failed') ? 1 : 0);
}
