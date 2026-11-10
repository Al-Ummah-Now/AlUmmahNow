/**
 * Release check for skew protection (docs/release-pipeline/SKEW-PROTECTION.md),
 * part of `pnpm check:config`. For web and admin-web, every wrangler config must:
 *   - run worker.ts (keeps the public host across the skew hop)
 *   - send /_next/static/* through the Worker (run_worker_first), identically
 *     everywhere: the one OpenNext build reads it from wrangler.jsonc
 * and every config that serves a custom domain (production, stage, QA) must:
 *   - enable preview URLs (old versions are reached through them)
 *   - set CF_WORKER_NAME to its own worker name and CF_PREVIEW_DOMAIN
 * open-next.config.ts must enable skewProtection with the retention the
 * mapping script uses.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from './jsonc.ts';
import { RETENTION } from './skew-mapping.ts';
import { resolveEnv, type WranglerConfig } from './wrangler-config.ts';

export const SKEW_APP_DIRS = ['apps/web', 'apps/admin-web'];
export const PREVIEW_DOMAIN = 'mahmoud-s-darwish';
export const RUN_WORKER_FIRST = ['/_next/static/*'];
/** Configs that serve a custom domain (the others are dev, PR previews or retired) */
const SERVING = new Set(['wrangler.production.jsonc', 'wrangler.qa.jsonc']);

export function checkSkewConfig(root: string): string[] {
	const errors: string[] = [];
	for (const dir of SKEW_APP_DIRS) {
		const onc = join(root, dir, 'open-next.config.ts');
		const text = existsSync(onc) ? readFileSync(onc, 'utf8') : '';
		if (!/skewProtection:\s*\{\s*enabled:\s*true/.test(text)) errors.push(`${dir}/open-next.config.ts: skewProtection is not enabled`);
		const retention = text.match(/SKEW_RETENTION\s*=\s*\{\s*maxNumberOfVersions:\s*(\d+),\s*maxVersionAgeDays:\s*(\d+)\s*\}/);
		if (!retention || Number(retention[1]) !== RETENTION.maxNumberOfVersions || Number(retention[2]) !== RETENTION.maxVersionAgeDays) {
			errors.push(`${dir}/open-next.config.ts: SKEW_RETENTION must equal skew-mapping.ts RETENTION ${JSON.stringify(RETENTION)}`);
		}
		if (!existsSync(join(root, dir, 'worker.ts'))) errors.push(`${dir}/worker.ts is missing`);

		for (const file of readdirSync(join(root, dir)).filter((f) => /^wrangler(\.[\w-]+)?\.jsonc$/.test(f))) {
			const config = parseJsonc(readFileSync(join(root, dir, file), 'utf8')) as WranglerConfig;
			const envs: (string | null)[] = [null, ...Object.keys(config.env ?? {})];
			for (const envName of envs) {
				const where = `${dir}/${file}${envName ? ` (env.${envName})` : ''}`;
				const { config: c, vars } = resolveEnv(config, envName);
				if (c.main !== 'worker.ts') errors.push(`${where}: main must be "worker.ts", not ${JSON.stringify(c.main)}`);
				const rwf = (c.assets as { run_worker_first?: unknown } | undefined)?.run_worker_first;
				if (JSON.stringify(rwf) !== JSON.stringify(RUN_WORKER_FIRST)) {
					errors.push(`${where}: assets.run_worker_first must be ${JSON.stringify(RUN_WORKER_FIRST)}`);
				}
				if (!SERVING.has(file)) continue;
				// preview_urls is inherited from the top level by named envs
				const preview = c.preview_urls ?? config.preview_urls;
				if (preview !== true) errors.push(`${where}: preview_urls must be true (skew protection reaches old versions through them)`);
				if (vars.CF_WORKER_NAME !== c.name) errors.push(`${where}: vars.CF_WORKER_NAME must be the worker name ${JSON.stringify(c.name)}`);
				if (vars.CF_PREVIEW_DOMAIN !== PREVIEW_DOMAIN) errors.push(`${where}: vars.CF_PREVIEW_DOMAIN must be ${JSON.stringify(PREVIEW_DOMAIN)}`);
			}
		}
	}
	return errors;
}
