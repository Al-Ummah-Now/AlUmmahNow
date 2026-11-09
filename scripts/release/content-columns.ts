/**
 * Backfill and check for the content_ownership columns the Studio Videos tab
 * filters on (migrations/search/0003_content_studio_columns.sql).
 *
 * Runs after the new api-videos is live, so every new write already fills the
 * columns and only older rows are left. It selects rows still missing them, so
 * it is idempotent and resumes by running it again. An update never overwrites
 * a row a live request has since filled.
 *
 *   node --experimental-strip-types scripts/release/content-columns.ts --env qa|stage|production [--check]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectOwnership } from '../../packages/shared-types/src/search/ownership.ts';
import { cfToken, createCfClient, d1Query, type CfClient } from './cf-api.ts';
import { parseJsonc } from './jsonc.ts';

export type ContentEnv = 'qa' | 'stage' | 'production';

export interface ColumnRow {
	id: string;
	studioStatus: string;
	title: string | null;
	category: string | null;
	language: string | null;
}

export interface BackfillIo {
	pendingIds(limit: number): Promise<string[]>;
	getObject(id: string): Promise<unknown | null>;
	setColumns(row: ColumnRow): Promise<void>;
	removeRow(id: string): Promise<void>;
	countMissing(): Promise<number>;
}

const READ_ATTEMPTS = 3;

interface Options {
	batch?: number;
	retryDelayMs?: number;
	log?: (message: string) => void;
}

async function readWithRetry(io: BackfillIo, id: string, delayMs: number): Promise<unknown | null> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await io.getObject(id);
		} catch (error) {
			if (attempt >= READ_ATTEMPTS) throw error;
			await new Promise((done) => setTimeout(done, delayMs * attempt));
		}
	}
}

export async function runBackfill(io: BackfillIo, options: Options = {}): Promise<{ updated: number; removed: number }> {
	const batch = options.batch ?? 100;
	const delayMs = options.retryDelayMs ?? 500;
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	let updated = 0;
	let removed = 0;
	let previous = '';
	for (;;) {
		const ids = await io.pendingIds(batch);
		if (ids.length === 0) break;
		const fingerprint = ids.join(',');
		if (fingerprint === previous) throw new Error(`Backfill made no progress at ${ids[0]}`);
		previous = fingerprint;

		await Promise.all(ids.map(async (id) => {
			const object = await readWithRetry(io, id, delayMs);
			const row = object === null ? null : projectOwnership('video', id, object);
			if (!row?.studioStatus) {
				await io.removeRow(id);
				removed++;
				return;
			}
			await io.setColumns({ id, studioStatus: row.studioStatus, title: row.title, category: row.category, language: row.language });
			updated++;
		}));
		log(`Backfilled ${updated}, removed ${removed}`);
	}
	return { updated, removed };
}

export async function runCheck(io: BackfillIo): Promise<{ ok: boolean; missing: number }> {
	const missing = await io.countMissing();
	return { ok: missing === 0, missing };
}

type Config = Record<string, unknown> & { env?: Record<string, Record<string, unknown>> };

function readConfig(env: ContentEnv): Config {
	const root = resolve(new URL('../..', import.meta.url).pathname);
	return parseJsonc(readFileSync(join(root, 'apps/api-videos', env === 'qa' ? 'wrangler.qa.jsonc' : 'wrangler.jsonc'), 'utf8')) as Config;
}

export function backfillTarget(env: ContentEnv, read: (env: ContentEnv) => Config = readConfig): { databaseId: string; bucket: string } {
	const config = read(env);
	const scope = (env === 'stage' ? config.env?.stage : config) as Record<string, unknown>;
	const database = (scope.d1_databases as Array<{ binding: string; database_id: string }>).find((d) => d.binding === 'SEARCH_DB');
	const bucket = (scope.r2_buckets as Array<{ binding: string; bucket_name: string }>).find((b) => b.binding === 'videos');
	if (!database || !bucket) throw new Error(`SEARCH_DB or videos binding missing for ${env}`);
	return { databaseId: database.database_id, bucket: bucket.bucket_name };
}

function liveIo(cf: CfClient, target: { databaseId: string; bucket: string }): BackfillIo {
	const token = cfToken();
	const query = <Row,>(sql: string, params: unknown[] = []) => d1Query<Row>(cf, target.databaseId, sql, params);
	return {
		pendingIds: async (limit) => (await query<{ id: string }>(
			`SELECT id FROM content_ownership WHERE kind = 'video' AND studio_status IS NULL ORDER BY id LIMIT ?`, [limit],
		)).map((row) => row.id),
		getObject: async (id) => {
			const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/r2/buckets/${target.bucket}/objects/${encodeURIComponent(id)}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`R2 read of ${id} -> ${res.status}`);
			return res.json();
		},
		setColumns: async (row) => {
			await query(
				`UPDATE content_ownership SET studio_status = ?, title = ?, category = ?, language = ?
				 WHERE kind = 'video' AND id = ? AND studio_status IS NULL`,
				[row.studioStatus, row.title, row.category, row.language, row.id],
			);
		},
		removeRow: async (id) => {
			await query(`DELETE FROM content_ownership WHERE kind = 'video' AND id = ? AND studio_status IS NULL`, [id]);
		},
		countMissing: async () => (await query<{ total: number }>(
			`SELECT COUNT(*) AS total FROM content_ownership WHERE kind = 'video' AND studio_status IS NULL`,
		))[0]?.total ?? 0,
	};
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	const argv = process.argv.slice(2);
	const env = argv[argv.indexOf('--env') + 1] as ContentEnv;
	if (env !== 'qa' && env !== 'stage' && env !== 'production') {
		process.stderr.write('usage: content-columns.ts --env qa|stage|production [--check]\n');
		process.exit(2);
	}
	const io = liveIo(createCfClient(), backfillTarget(env));
	const work = argv.includes('--check')
		? runCheck(io).then(({ ok, missing }) => {
			process.stdout.write(`content_ownership rows missing the Studio columns on ${env}: ${missing}\n`);
			if (!ok) process.exit(1);
		})
		: runBackfill(io).then(({ updated, removed }) => process.stdout.write(`Backfill on ${env} done: ${updated} updated, ${removed} removed\n`));
	work.catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
