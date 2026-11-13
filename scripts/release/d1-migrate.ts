/**
 * Applies the D1 migrations of a release env, before its candidates are uploaded.
 * Migrations are expand-only (pnpm check:migrations), so the version still serving
 * keeps working and a rollback never has to undo them. Stage runs first in every
 * release, so each migration is rehearsed there before it reaches production.
 *
 *   node --experimental-strip-types scripts/release/d1-migrate.ts --env stage|production [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReleaseEnv } from './promote.ts';

/** Each database is migrated from the one app whose config sets its migrations_dir. */
export const DATABASES = [
	{ app: 'api-videos', database: 'al-ummah-now-search' },
	{ app: 'processor', database: 'al-ummah-now-notifications' },
	{ app: 'admin-api', database: 'al-ummah-now-reports' },
	// Platform analytics rollups (docs/admin/LIVE_OPS.md); admin-api reads them
	{ app: 'cost-monitor', database: 'al-ummah-now-costs' },
	// Public status page (docs/status-page/README.md); admin-api writes its incidents
	{ app: 'status', database: 'al-ummah-now-status' },
] as const;

export function migrateCommands(env: ReleaseEnv): { app: string; argv: string[] }[] {
	return DATABASES.map(({ app, database }) => ({
		app,
		argv: ['d1', 'migrations', 'apply', env === 'stage' ? `${database}-stage` : database, '--remote', '-c', 'wrangler.jsonc', ...(env === 'stage' ? ['--env', 'stage'] : [])],
	}));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const argv = process.argv.slice(2);
	const env = argv[argv.indexOf('--env') + 1];
	if (env !== 'stage' && env !== 'production') {
		process.stderr.write('usage: d1-migrate.ts --env stage|production [--dry-run]\n');
		process.exit(2);
	}
	const root = fileURLToPath(new URL('../..', import.meta.url));
	for (const { app, argv: args } of migrateCommands(env)) {
		process.stdout.write(`\n== ${app}: wrangler ${args.join(' ')}\n`);
		if (argv.includes('--dry-run')) continue;
		execFileSync('npx', ['wrangler', ...args], { cwd: join(root, 'apps', app), stdio: 'inherit', env: { ...process.env, CI: 'true' } });
	}
}
