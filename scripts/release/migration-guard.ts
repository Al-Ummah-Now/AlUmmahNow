/**
 * Migrations are append-only (SPEC §6.2): a migration that may already have run in
 * some environment must never change, and new migrations must sort after the
 * existing ones (wrangler applies them in name order and skips names it has seen).
 *
 *   pnpm check:migrations <base-ref>
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * A migration file: any .sql under `apps/<app>/migrations*`, including subdirs
 * (apps/api-videos/migrations/search/0001_x.sql). Schema snapshots
 * (`*.schema.snapshot.sql`) are generated, not migrations.
 */
export const MIGRATION_DIR = /^apps\/[^/]+\/migrations[^/]*\/(?:[^/]+\/)*[^/]+\.sql$/;
const SNAPSHOT = /\.schema\.snapshot\.sql$/;
export const isMigration = (path: string) => MIGRATION_DIR.test(path) && !SNAPSHOT.test(path);

export interface Change {
	status: string;
	path: string;
	/** For renames: the old path. */
	from?: string;
}

export function parseNameStatus(output: string): Change[] {
	return output
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [status, a, b] = line.split('\t');
			return status.startsWith('R') || status.startsWith('C') ? { status: status[0], path: b, from: a } : { status: status[0], path: a };
		});
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * The one escape (SPEC §6.2): a migration that has never been applied in ANY
 * environment (its name is absent from d1_migrations in QA, stage and
 * production) may be corrected in place, once. Each entry pins the sha256 of
 * the corrected file, so any later edit is refused again. Record the evidence.
 */
export const NEVER_APPLIED_FIXES: Readonly<Record<string, { sha256: string; reason: string }>> = {
  'apps/api-videos/migrations/search/0005_admin_content.sql': {
    sha256: 'f9ed626bb8e39687d804557a781ecc882687eea11565fe73369b1504aa372c53',
    reason:
      '2026-11-10 (#604): failed on QA with "duplicate column name: title" (QA has content_ownership.title from the Creator Studio preview migration) and was recorded nowhere: d1_migrations on QA, stage and production list only 0001-0004. Corrected to add admin_title.',
  },
};

/**
 * The other escape: a migration that a PR preview already applied on QA under
 * its own name (so QA's d1_migrations lists it) keeps that name when it lands,
 * even though it sorts before newer ones. Wrangler applies every name it has
 * not recorded, so stage and production run it as new and QA skips it; a
 * renamed copy would fail on QA with "duplicate column". Pinned by sha256.
 */
export const PREVIEW_APPLIED: Readonly<Record<string, { sha256: string; reason: string }>> = {
  'apps/api-videos/migrations/search/0003_content_studio_columns.sql': {
    sha256: 'df5749a1e87ee1af2e53430553ad2a89ee5e058146780ca352bed47ea7a058b2',
    reason: '2026-11-09: applied on QA search DB by the Creator Studio PR preview (#499); QA has studio_status, title, category, language. Landed 2026-11-10 with the Studio (#498).',
  },
};

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * @param changes  name-status diff base...head
 * @param baseFiles every migration file path that exists at base
 */
export function checkMigrations(
	changes: Change[],
	baseFiles: string[],
	/** Content of a file at head, for the NEVER_APPLIED_FIXES check. */
	headContent: (path: string) => string | null = () => null,
	fixes: Readonly<Record<string, { sha256: string }>> = NEVER_APPLIED_FIXES,
	previewApplied: Readonly<Record<string, { sha256: string }>> = PREVIEW_APPLIED,
): string[] {
	const errors: string[] = [];
	const latest = new Map<string, string>();
	for (const f of baseFiles) {
		if (!isMigration(f)) continue;
		const d = dirOf(f);
		if (!latest.has(d) || nameOf(f) > latest.get(d)!) latest.set(d, nameOf(f));
	}
	for (const c of changes) {
		const touched = [c.path, c.from].filter((p): p is string => !!p && isMigration(p));
		if (touched.length === 0) continue;
		if (c.status === 'M' && fixes[c.path]) {
			const content = headContent(c.path);
			if (content !== null && sha256(content) === fixes[c.path].sha256) continue;
			errors.push(`${c.path}: differs from its recorded never-applied fix (NEVER_APPLIED_FIXES). Add a new migration instead.`);
		} else if (c.status === 'M') errors.push(`${c.path}: existing migration modified. Add a new migration instead.`);
		else if (c.status === 'D') errors.push(`${c.path}: existing migration deleted.`);
		else if (c.status === 'R') errors.push(`${c.from} → ${c.path}: existing migration renamed.`);
		else if (c.status === 'A' || c.status === 'C') {
			const last = latest.get(dirOf(c.path));
			const pinned = previewApplied[c.path];
			if (pinned && sha256(headContent(c.path) ?? '') === pinned.sha256) continue;
			if (last && nameOf(c.path) <= last) {
				errors.push(`${c.path}: new migration sorts before the latest existing one (${last}); it may never run where ${last} already ran.`);
			}
		}
	}
	return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const base = process.argv[2];
	if (!base) {
		process.stderr.write('usage: migration-guard.ts <base-ref>\n');
		process.exit(2);
	}
	const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
	const mergeBase = git('merge-base', base, 'HEAD').trim();
	const changes = parseNameStatus(git('diff', '--name-status', '-M', `${mergeBase}`, 'HEAD'));
	const baseFiles = git('ls-tree', '-r', '--name-only', mergeBase).split('\n');
	const headContent = (path: string) => {
		try {
			return git('show', `HEAD:${path}`);
		} catch {
			return null;
		}
	};
	const errors = checkMigrations(changes, baseFiles, headContent);
	if (errors.length) {
		process.stderr.write(`Migration guard failed:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
		process.exit(1);
	}
	process.stdout.write(`Migration guard passed (base ${mergeBase.slice(0, 7)}).\n`);
}
