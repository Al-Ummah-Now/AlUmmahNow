/**
 * Writes or checks the committed D1 schema snapshots (SPEC §6.2).
 *   pnpm check:schema      (CI)
 *   pnpm schema:snapshot   (regenerate after adding a migration)
 *
 * Every D1 migrations dir (a dir under `apps/<app>/migrations*` that holds .sql
 * files, e.g. apps/processor/migrations-notifications or
 * apps/api-videos/migrations/search) gets one snapshot, `<dir>.schema.snapshot.sql`,
 * next to (not inside) the dir: wrangler applies every .sql file inside it.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema } from './d1-schema.ts';

export const SNAPSHOT_SUFFIX = '.schema.snapshot.sql';
/** Wrangler applies every .sql file in a migrations dir; snapshots are never inside one. */
const MIGRATION_SQL = /^(?!.*\.schema\.snapshot\.sql$).*\.sql$/;

const isMigrationFile = (name: string) => MIGRATION_SQL.test(name);

function walk(dir: string, visit: (dir: string, files: string[]) => void): void {
	const entries = readdirSync(dir);
	visit(dir, entries.filter((e) => statSync(join(dir, e)).isFile()));
	for (const e of entries) {
		if (statSync(join(dir, e)).isDirectory()) walk(join(dir, e), visit);
	}
}

/** Repo-relative paths of every D1 migrations dir and every committed snapshot. */
export function discover(root: string): { migrationDirs: string[]; snapshots: string[] } {
	const migrationDirs: string[] = [];
	const snapshots: string[] = [];
	const appsDir = join(root, 'apps');
	if (!existsSync(appsDir)) return { migrationDirs, snapshots };
	for (const app of readdirSync(appsDir).sort()) {
		const appDir = join(appsDir, app);
		if (!statSync(appDir).isDirectory()) continue;
		for (const entry of readdirSync(appDir).sort()) {
			const path = join(appDir, entry);
			if (entry.startsWith('migrations') && entry.endsWith(SNAPSHOT_SUFFIX)) snapshots.push(relative(root, path));
			if (!entry.startsWith('migrations') || !statSync(path).isDirectory()) continue;
			walk(path, (dir, files) => {
				if (files.some(isMigrationFile)) migrationDirs.push(relative(root, dir));
				for (const f of files) if (f.endsWith(SNAPSHOT_SUFFIX)) snapshots.push(relative(root, join(dir, f)));
			});
		}
	}
	return { migrationDirs: migrationDirs.sort(), snapshots: snapshots.sort() };
}

export interface SnapshotDiff {
	file: string;
	/** null: the snapshot belongs to a migrations dir that no longer exists. */
	expected: string | null;
	actual: string | null;
}

export function snapshotDiffs(root: string): SnapshotDiff[] {
	const { migrationDirs, snapshots } = discover(root);
	const out: SnapshotDiff[] = [];
	const wanted = new Set<string>();
	for (const dir of migrationDirs) {
		const file = `${dir}${SNAPSHOT_SUFFIX}`;
		wanted.add(file);
		const expected = buildSchema([{ label: dir, dir: join(root, dir), pattern: MIGRATION_SQL }]);
		const path = join(root, file);
		const actual = existsSync(path) ? readFileSync(path, 'utf8') : null;
		if (actual !== expected) out.push({ file, expected, actual });
	}
	for (const file of snapshots) {
		if (!wanted.has(file)) out.push({ file, expected: null, actual: readFileSync(join(root, file), 'utf8') });
	}
	return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const root = process.cwd();
	const write = process.argv.includes('--write');
	const diffs = snapshotDiffs(root);
	if (write) {
		for (const d of diffs) {
			if (d.expected === null) unlinkSync(join(root, d.file));
			else writeFileSync(join(root, d.file), d.expected);
		}
		process.stdout.write(diffs.length ? `Updated ${diffs.map((d) => d.file).join(', ')}\n` : 'Schema snapshots already up to date.\n');
	} else if (diffs.length) {
		const describe = (d: SnapshotDiff) =>
			d.expected === null ? `${d.file} (its migrations dir is gone)` : d.actual === null ? `${d.file} (missing)` : d.file;
		process.stderr.write(
			`Schema snapshot out of date: ${diffs.map(describe).join(', ')}\n` +
				'A migration changed the schema (or a snapshot was edited by hand).\n' +
				'Run `pnpm schema:snapshot` and commit the result together with the migration.\n'
		);
		process.exit(1);
	} else {
		process.stdout.write(`Schema snapshots up to date (${discover(root).migrationDirs.join(', ')}).\n`);
	}
}
