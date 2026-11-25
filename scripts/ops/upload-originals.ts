/**
 * Read-only check of uploads that failed with "no_video_stream": is the stored original the file the
 * client announced, and what is in it?
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node --experimental-strip-types scripts/ops/upload-originals.ts --env production [--hours 48]
 *
 * For at most MAX_FILES failed jobs of the window (media_jobs, by status and time) whose original is at most
 * MAX_BYTES: reads the original's parts from the originals bucket (R2 API, GET), joins them in a temporary folder
 * that is deleted at the end, and prints one line per file: the size against the manifest and the import item, the
 * SHA-256 against the import item's (equal, different or no item), the container kind, the streams' types and
 * codecs (ffprobe) and the share of zero bytes; then how many "Import Hash failed" samples have the size of one of
 * these files. No file names, titles, user ids, hashes or media are printed; ids by their first 8 characters (scrub.ts).
 *
 * D1 is read with bounded SELECTs on indexed columns; nothing is changed and no app endpoint is called.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { scrub } from './scrub.ts';

const API = 'https://api.cloudflare.com/client/v4';
export const MAX_FILES = 10;
export const MAX_BYTES = 64 * 1024 * 1024;

type EnvName = 'production' | 'stage';

/** api-videos' search D1 (media_jobs), admin-api's reports D1 (imports, errors) and the originals bucket, per wrangler config. */
export const RESOURCES: Record<EnvName, { search: string; reports: string; bucket: string }> = {
	production: { search: '41064871-cf1f-46e9-b102-7b913240ad89', reports: '7bee932d-c6b1-47c2-ab70-7dba349104af', bucket: 'al-ummah-now-media-originals' },
	stage: { search: '956a3550-bd20-4cfc-9bf2-b1c2265b33dd', reports: '2b2c07fc-2823-46e0-958f-acfc401544ff', bucket: 'al-ummah-now-media-originals-stage' },
};

/** Failed jobs, newest first (idx_media_jobs_status). */
export const JOBS_SQL = `SELECT video_id, error, failed_at FROM media_jobs
 WHERE status = 'failed' AND updated_at >= ?1 AND instr(error, 'no_video_stream') > 0 ORDER BY updated_at DESC LIMIT ${MAX_FILES}`;
/** The newest import batches (idx_import_batches_created). */
export const BATCHES_SQL = `SELECT id FROM import_batches WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT 20`;
/** One batch's items of the given videos (idx_import_items_batch). */
export const itemsSql = (n: number) =>
	`SELECT video_id, sha256, file_size, file_name FROM import_items WHERE batch_id = ?1 AND video_id IN (${Array.from({ length: n }, (_, i) => `?${i + 2}`).join(', ')}) LIMIT ${MAX_FILES}`;
/** The "Import Hash failed" groups (idx_error_groups_app) and their samples (idx_error_events_group, at most 50 each). */
export const HASH_GROUPS_SQL = `SELECT id, occurrences FROM error_groups WHERE app = 'tools' AND last_seen >= ?1 AND culprit = '/import/hash' ORDER BY last_seen DESC LIMIT 5`;
export const HASH_SIZES_SQL = `SELECT json_extract(extra_json, '$.fileSize') AS size FROM error_events WHERE group_id = ?1 ORDER BY occurred_at DESC LIMIT 100`;

const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const headers = { authorization: `Bearer ${token}` };

/** The container a file's first bytes say it is. */
export function kindOf(head: Uint8Array): string {
	const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
	if (head.length < 12) return 'too short';
	if (head.every((b) => b === 0)) return 'zeros';
	if (ascii(4, 8) === 'ftyp') return `mp4/mov (${ascii(8, 12).replace(/[^ -~]/g, '.').trim()})`;
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'matroska/webm';
	if (ascii(0, 4) === 'RIFF') return `riff (${ascii(8, 12).replace(/[^ -~]/g, '.').trim()})`;
	if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) return 'mp3/aac';
	if (ascii(0, 4) === 'OggS') return 'ogg';
	if (ascii(0, 4) === 'fLaC') return 'flac';
	return 'unknown';
}

/** "mov,mp4,m4a: audio aac, cover mjpeg, 812 s" from ffprobe's JSON. */
export function streamsOf(json: string): string {
	const j = JSON.parse(json) as { streams?: { codec_type?: string; codec_name?: string; disposition?: { attached_pic?: number } }[]; format?: { format_name?: string; duration?: string } };
	const streams = (j.streams ?? []).map((s) => `${s.disposition?.attached_pic ? 'cover' : s.codec_type ?? '?'} ${s.codec_name ?? '?'}`);
	return `${j.format?.format_name ?? '?'}: ${streams.join(', ') || 'no streams'}, ${Math.round(Number(j.format?.duration) || 0)} s`;
}

/** Extension, and whether the name is a downloader's unmerged part ("x.f140.m4a", "x.f251.webm", "x.temp.mp4"). Never the name. */
export function nameShape(fileName: string): string {
	const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? 'none';
	return `.${ext}${/\.(f\d{2,4}(-\w+)?|temp|part)\.[a-z0-9]+$/i.test(fileName) ? ' (downloader part)' : ''}`;
}

/** The parts of one upload in order: which bytes of each make up [0, size); null when there is a gap. */
export function plan(objects: { key: string; size: number }[], prefix: string, size: number): { key: string; skip: number; take: number }[] | null {
	const parts = objects
		.filter((o) => o.key.startsWith(prefix) && /^\d{15}$/.test(o.key.slice(prefix.length)))
		.map((o) => ({ key: o.key, at: Number(o.key.slice(prefix.length)), size: o.size }))
		.sort((a, b) => a.at - b.at);
	const out: { key: string; skip: number; take: number }[] = [];
	let pos = 0;
	for (const x of parts) {
		if (pos >= size) break;
		if (x.at > pos) return null;
		const end = Math.min(x.at + x.size, size);
		if (end <= pos) continue;
		out.push({ key: x.key, skip: pos - x.at, take: end - pos });
		pos = end;
	}
	return pos >= size ? out : null;
}

const out: string[] = [];
const p = (s = '') => out.push(scrub(s));

async function d1(db: string, sql: string, params: unknown[]): Promise<any[]> {
	if (!/^\s*SELECT\b/i.test(sql)) throw new Error('SELECT only');
	const res = await fetch(`${API}/accounts/${account}/d1/database/${db}/query`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
	const body: any = await res.json().catch(() => null);
	if (!res.ok || body?.success === false) throw new Error(`D1 HTTP ${res.status} ${JSON.stringify(body?.errors ?? null)}`);
	return body?.result?.[0]?.results ?? [];
}

const r2 = (bucket: string, rest: string) => fetch(`${API}/accounts/${account}/r2/buckets/${bucket}/objects${rest}`, { headers });

async function listParts(bucket: string, prefix: string): Promise<{ key: string; size: number }[]> {
	const res = await r2(bucket, `?per_page=1000&prefix=${encodeURIComponent(prefix)}`);
	const body: any = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`R2 list HTTP ${res.status}`);
	return (body?.result ?? []).map((o: any) => ({ key: String(o.key), size: Number(o.size) }));
}

async function readObject(bucket: string, key: string): Promise<Buffer> {
	const res = await r2(bucket, `/${key.split('/').map(encodeURIComponent).join('/')}`);
	if (!res.ok) throw new Error(`R2 read HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

async function checkOne(env: EnvName, dir: string, videoId: string, item: { sha256: string; file_size: number; file_name: string } | undefined): Promise<void> {
	const { bucket } = RESOURCES[env];
	const id = `${videoId.slice(0, 8)}…`;
	const manifest = JSON.parse((await readObject(bucket, `src/${videoId}/manifest.json`)).toString('utf8')) as { uploadId: string; size: number };
	if (manifest.size > MAX_BYTES) return p(`- ${id}: ${manifest.size} bytes, larger than this check reads`);
	const prefix = `src/${videoId}/${manifest.uploadId}/`;
	const steps = plan(await listParts(bucket, prefix), prefix, manifest.size);
	if (!steps) return p(`- ${id}: the stored parts do not cover the ${manifest.size} bytes of the manifest`);
	const file = join(dir, 'original');
	const hash = createHash('sha256');
	let head = Buffer.alloc(0);
	let total = 0;
	let zeros = 0;
	const fh = await open(file, 'w');
	try {
		for (const s of steps) {
			const bytes = (await readObject(bucket, s.key)).subarray(s.skip, s.skip + s.take);
			hash.update(bytes);
			await fh.write(bytes);
			if (!head.length) head = Buffer.from(bytes.subarray(0, 16));
			total += bytes.length;
			for (const b of bytes) if (b === 0) zeros++;
		}
	} finally {
		await fh.close();
	}
	const streams = await promisify(execFile)('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 60_000 })
		.then((r) => streamsOf(r.stdout))
		.catch((e: { code?: unknown }) => `ffprobe could not read it (${String(e.code ?? 'error')})`);
	const sha = hash.digest('hex');
	const match = !item ? 'no import item' : `SHA-256 ${sha === item.sha256 ? 'equal to' : 'DIFFERENT from'} the importer's, size ${Number(item.file_size) === total ? 'equal' : 'DIFFERENT'}, named ${nameShape(item.file_name)}`;
	p(`- ${id}: ${total} bytes in ${steps.length} parts (manifest ${manifest.size}); ${match}; starts as ${kindOf(head)}; ${streams}; ${((100 * zeros) / Math.max(1, total)).toFixed(1)}% zero bytes`);
	await rm(file, { force: true });
}

async function main(): Promise<void> {
	if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
	const value = (name: string, d: string) => {
		const i = process.argv.indexOf(`--${name}`);
		return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d;
	};
	const env = value('env', 'production') as EnvName;
	if (!(env in RESOURCES)) throw new Error('--env must be production or stage');
	const hours = Math.min(72, Math.max(1, Number(value('hours', '48')) || 48));
	const since = new Date(Date.now() - hours * 3600_000).toISOString();
	const { search, reports } = RESOURCES[env];
	p(`# Originals of uploads without a video stream: ${env}, since ${since}`);
	const jobs = await d1(search, JOBS_SQL, [since]);
	p(`${jobs.length} failed jobs`);
	const ids = jobs.map((j) => String(j.video_id));
	const items = new Map<string, { sha256: string; file_size: number; file_name: string }>();
	if (ids.length) {
		// A batch may be older than the failure: a week back
		for (const b of await d1(reports, BATCHES_SQL, [new Date(Date.now() - 7 * 24 * 3600_000).toISOString()])) {
			for (const i of await d1(reports, itemsSql(ids.length), [b.id, ...ids])) items.set(String(i.video_id), i);
			if (items.size === ids.length) break;
		}
	}
	const dir = await mkdtemp(join(tmpdir(), 'originals-'));
	try {
		for (const id of ids) await checkOne(env, dir, id, items.get(id)).catch((e) => p(`- ${id.slice(0, 8)}…: not readable: ${e instanceof Error ? e.message : String(e)}`));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	const sizes = new Set([...items.values()].map((i) => Number(i.file_size)));
	let samples = 0;
	let same = 0;
	let total = 0;
	for (const g of await d1(reports, HASH_GROUPS_SQL, [since])) {
		total += Number(g.occurrences);
		for (const e of await d1(reports, HASH_SIZES_SQL, [g.id])) {
			samples++;
			if (sizes.has(Number(e.size))) same++;
		}
	}
	p(`- "Import Hash failed": ${total} times, ${samples} samples kept, ${same} of them with the exact size of one of these files`);
	process.stdout.write(out.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(`upload-originals failed: ${scrub(error instanceof Error ? error.message : String(error))}\n`);
		process.exit(1);
	});
}
