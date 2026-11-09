/**
 * Per-PR preview configs (issue #486). A preview is only ever built from an
 * app's QA config: QA buckets, databases, queues and auth, under its own Worker
 * name, with no route, cron or queue consumer. previewProblems() refuses anything
 * that points at production, and CI runs it on the real configs.
 *
 *   node --experimental-strip-types scripts/release/preview-config.ts \
 *     --app web|api-videos --pr 498 --subdomain acct --out apps/web/wrangler.pr-preview.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseJsonc } from './jsonc.ts';

export type PreviewApp = 'web' | 'api-videos';
type Config = Record<string, unknown>;

export interface PreviewOptions {
	pr: number;
	subdomain: string;
}

const WORKER_PREFIX: Record<PreviewApp, string> = { web: 'al-ummah-web-pr', 'api-videos': 'al-ummah-api-pr' };
const ROOT = resolve(new URL('../..', import.meta.url).pathname);

export function previewName(app: PreviewApp, pr: number): string {
	return `${WORKER_PREFIX[app]}-${pr}`;
}

export function previewUrl(app: PreviewApp, { pr, subdomain }: PreviewOptions): string {
	return `https://${previewName(app, pr)}.${subdomain}.workers.dev`;
}

export function readQaConfig(app: PreviewApp): Config {
	return parseJsonc(readFileSync(join(ROOT, 'apps', app, 'wrangler.qa.jsonc'), 'utf8')) as Config;
}

export function buildPreviewConfig(app: PreviewApp, qa: Config, options: PreviewOptions): Config {
	const { routes: _routes, route: _route, triggers: _triggers, tail_consumers: _tail, ...config } = qa;
	const vars = { ...(qa.vars as Record<string, string> | undefined) };
	if (app === 'web') vars.API_URL = previewUrl('api-videos', options);
	if (app === 'api-videos') vars.CORS_ORIGINS = [vars.CORS_ORIGINS, previewUrl('web', options)].filter(Boolean).join(',');

	const preview: Config = { ...config, name: previewName(app, options.pr), workers_dev: true, vars };
	if (qa.queues) preview.queues = { ...(qa.queues as Config), consumers: [] };
	return preview;
}

/** Names and ids of production resources, from every app's production config. */
export function productionIdentifiers(): Set<string> {
	const ids = new Set<string>();
	const collect = (scope: Config | undefined) => {
		if (!scope) return;
		for (const bucket of (scope.r2_buckets as Array<{ bucket_name?: string }> | undefined) ?? []) if (bucket.bucket_name) ids.add(bucket.bucket_name);
		for (const db of (scope.d1_databases as Array<{ database_name?: string; database_id?: string }> | undefined) ?? []) {
			if (db.database_name) ids.add(db.database_name);
			if (db.database_id) ids.add(db.database_id);
		}
		for (const kv of (scope.kv_namespaces as Array<{ id?: string }> | undefined) ?? []) if (kv.id) ids.add(kv.id);
		for (const producer of ((scope.queues as Config | undefined)?.producers as Array<{ queue?: string }> | undefined) ?? []) if (producer.queue) ids.add(producer.queue);
	};
	for (const app of readdirSync(join(ROOT, 'apps'))) {
		for (const file of ['wrangler.jsonc', 'wrangler.production.jsonc']) {
			const path = join(ROOT, 'apps', app, file);
			if (!existsSync(path)) continue;
			const config = parseJsonc(readFileSync(path, 'utf8')) as Config;
			collect(config);
			collect((config.env as Record<string, Config> | undefined)?.production);
		}
	}
	return ids;
}

const OUR_HOST = /[a-z0-9.-]*alummahnow\.(?:net|com)/gi;
const NON_PRODUCTION = /(?:^|\.)(?:qa|stage)\./i;

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

/** Why this config must not be deployed as a preview. Empty when it's safe. */
export function previewProblems(config: Config, production: ReadonlySet<string>): string[] {
	const problems: string[] = [];
	if (!/^al-ummah-(?:web|api)-pr-\d+$/.test(String(config.name))) problems.push(`not a preview Worker name: ${String(config.name)}`);
	if (config.routes || config.route) problems.push('a preview must not claim a route');

	const bindings = [
		...((config.r2_buckets as Array<{ bucket_name?: string }> | undefined) ?? []).map((b) => b.bucket_name),
		...((config.d1_databases as Array<{ database_name?: string; database_id?: string }> | undefined) ?? []).flatMap((d) => [d.database_name, d.database_id]),
		...((config.kv_namespaces as Array<{ id?: string }> | undefined) ?? []).map((k) => k.id),
		...(((config.queues as Config | undefined)?.producers as Array<{ queue?: string }> | undefined) ?? []).map((q) => q.queue),
	];
	for (const binding of bindings) if (binding && production.has(binding)) problems.push(`production binding: ${binding}`);

	for (const text of strings({ vars: config.vars, services: config.services })) {
		for (const host of text.match(OUR_HOST) ?? []) if (!NON_PRODUCTION.test(host)) problems.push(`production host: ${host}`);
	}
	return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	const flag = (name: string) => {
		const index = process.argv.indexOf(`--${name}`);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};
	const app = flag('app') as PreviewApp;
	const pr = Number(flag('pr'));
	const subdomain = flag('subdomain');
	const out = flag('out');
	if ((app !== 'web' && app !== 'api-videos') || !Number.isInteger(pr) || !subdomain || !out) {
		process.stderr.write('usage: preview-config.ts --app web|api-videos --pr N --subdomain S --out FILE\n');
		process.exit(2);
	}
	const config = buildPreviewConfig(app, readQaConfig(app), { pr, subdomain });
	const problems = previewProblems(config, productionIdentifiers());
	if (problems.length > 0) {
		process.stderr.write(`Refusing to deploy this preview:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
		process.exit(1);
	}
	writeFileSync(out, JSON.stringify(config, null, 2));
	process.stdout.write(`${config.name} -> ${previewUrl(app, { pr, subdomain })}\n`);
}
