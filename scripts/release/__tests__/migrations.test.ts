import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSchema } from '../d1-schema.ts';
import { checkMigrations, NEVER_APPLIED_FIXES, parseNameStatus, sha256 } from '../migration-guard.ts';
import { discover, snapshotDiffs } from '../schema-snapshot.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const base = [
	'apps/processor/migrations/0001_reports.sql',
	'apps/processor/migrations/0002_more.sql',
	'apps/processor/migrations-notifications/0001_notifications.sql',
	'apps/api-videos/migrations/search/0001_search_index.sql',
	'apps/api-videos/migrations/search/0002_content_ownership.sql',
	'apps/processor/src/index.ts',
];
const guard = (diff: string) => checkMigrations(parseNameStatus(diff), base);

describe('migration guard', () => {
	it('allows appending a new migration', () => {
		assert.deepEqual(guard('A\tapps/processor/migrations/0003_add_col.sql'), []);
	});

	it('rejects modifying, deleting or renaming an existing migration', () => {
		const errors = guard(
			[
				'M\tapps/processor/migrations/0001_reports.sql',
				'D\tapps/processor/migrations/0002_more.sql',
				'R100\tapps/processor/migrations/0001_reports.sql\tapps/processor/migrations/0001_renamed.sql',
			].join('\n')
		);
		assert.equal(errors.length, 3);
		assert.ok(errors[0].includes('modified'));
		assert.ok(errors[1].includes('deleted'));
		assert.ok(errors[2].includes('renamed'));
	});

	it('allows the one recorded fix of a never-applied migration, and nothing else', () => {
		const path = 'apps/processor/migrations/0002_more.sql';
		const fixes = { [path]: { sha256: sha256('fixed') } };
		const diff = parseNameStatus(`M\t${path}`);
		assert.deepEqual(checkMigrations(diff, base, () => 'fixed', fixes), []);
		assert.match(checkMigrations(diff, base, () => 'edited again', fixes)[0], /never-applied fix/);
		assert.match(checkMigrations(parseNameStatus(`D\t${path}`), base, () => null, fixes)[0], /deleted/);
		assert.match(checkMigrations(parseNameStatus('M\tapps/processor/migrations/0001_reports.sql'), base, () => 'x', fixes)[0], /modified/);
	});

	it('every recorded never-applied fix matches the committed file', () => {
		for (const [path, fix] of Object.entries(NEVER_APPLIED_FIXES)) {
			assert.equal(sha256(readFileSync(join(ROOT, path), 'utf8')), fix.sha256, path);
		}
	});

	it('covers migrations in subdirs (api-videos migrations/search)', () => {
		const errors = guard('M\tapps/api-videos/migrations/search/0001_search_index.sql');
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes('modified'));
	});

	it('orders new migrations per dir', () => {
		// 0002 exists in migrations/ but not in migrations-notifications/.
		assert.deepEqual(guard('A\tapps/processor/migrations-notifications/0002_library.sql'), []);
		assert.ok(guard('A\tapps/api-videos/migrations/search/0001a_late.sql')[0].includes('sorts before'));
		assert.ok(guard('A\tapps/processor/migrations/0001a_late.sql')[0].includes('sorts before'));
	});

	it('ignores files outside migrations dirs and the generated snapshots', () => {
		assert.deepEqual(guard('M\tapps/processor/src/index.ts'), []);
		assert.deepEqual(guard('M\tapps/processor/migrations.schema.snapshot.sql'), []);
		assert.deepEqual(guard('M\tapps/api-videos/migrations/search.schema.snapshot.sql'), []);
	});
});

describe('schema snapshot', () => {
	it('committed snapshots match the migrations', () => {
		assert.deepEqual(
			snapshotDiffs(ROOT).map((d) => d.file),
			[]
		);
	});

	it('changes when a migration adds a column', () => {
		const dir = mkdtempSync(join(tmpdir(), 'schema-'));
		mkdirSync(join(dir, 'm'));
		writeFileSync(join(dir, 'm', '0001.sql'), 'CREATE TABLE users (id TEXT PRIMARY KEY);');
		const before = buildSchema([{ label: 'm', dir: join(dir, 'm'), pattern: /\.sql$/ }]);
		writeFileSync(join(dir, 'm', '0002.sql'), 'ALTER TABLE users ADD COLUMN email TEXT;');
		const after = buildSchema([{ label: 'm', dir: join(dir, 'm'), pattern: /\.sql$/ }]);
		assert.notEqual(after, before);
		assert.ok(after.includes('email TEXT'));
		rmSync(dir, { recursive: true });
	});

	it('names the migration that fails to apply', () => {
		const dir = mkdtempSync(join(tmpdir(), 'schema-'));
		writeFileSync(join(dir, '0001.sql'), 'ALTER TABLE missing ADD COLUMN x TEXT;');
		assert.throws(() => buildSchema([{ label: 'm', dir, pattern: /\.sql$/ }]), /m\/0001\.sql failed to apply/);
		rmSync(dir, { recursive: true });
	});

	it('finds every migrations dir, including subdirs, and flags missing and orphaned snapshots', () => {
		const root = mkdtempSync(join(tmpdir(), 'repo-'));
		const sql = (p: string, s = 'CREATE TABLE t (id TEXT);') => {
			mkdirSync(join(root, p, '..'), { recursive: true });
			writeFileSync(join(root, p), s);
		};
		sql('apps/api-videos/migrations/search/0001_search.sql');
		sql('apps/processor/migrations/0001_reports.sql');
		sql('apps/processor/migrations-notifications/0001_n.sql');
		sql('apps/processor/src/schema.sql');
		sql('apps/gone/migrations.schema.snapshot.sql', '-- stale');

		assert.deepEqual(discover(root).migrationDirs, [
			'apps/api-videos/migrations/search',
			'apps/processor/migrations',
			'apps/processor/migrations-notifications',
		]);
		const diffs = snapshotDiffs(root);
		assert.deepEqual(diffs.map((d) => [d.file, d.actual === null, d.expected === null]), [
			['apps/api-videos/migrations/search.schema.snapshot.sql', true, false],
			['apps/processor/migrations.schema.snapshot.sql', true, false],
			['apps/processor/migrations-notifications.schema.snapshot.sql', true, false],
			['apps/gone/migrations.schema.snapshot.sql', false, true],
		]);

		// Once written, the snapshot inside migrations/ is not mistaken for a migration.
		for (const d of diffs) if (d.expected) writeFileSync(join(root, d.file), d.expected);
		rmSync(join(root, 'apps/gone'), { recursive: true });
		assert.deepEqual(snapshotDiffs(root), []);
		assert.ok(readFileSync(join(root, 'apps/api-videos/migrations/search.schema.snapshot.sql'), 'utf8').includes('CREATE TABLE t'));
		rmSync(root, { recursive: true });
	});
});
