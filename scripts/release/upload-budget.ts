/**
 * Upload budget: how many uploads one E2E run sent to QA / stage.
 *
 * QA and stage share one Bunny Stream library, and every upload with bytes is
 * one Bunny encode. On 2026-11-10 the E2E suites sent ~4,400 QA upload
 * sessions in a day and filled that library's encoding queue (uploads sat at
 * "processing 0%" for many minutes). This counts a run's uploads from the
 * API's own counters, so a regression shows on the run that caused it.
 *
 * Source: upload_rate_windows (search D1), the per-user day counters the
 * upload limiter keeps for every upload session ("video_upload_session") and
 * resumed TUS session ("video_upload_continue"); the run's users come from
 * the auth D1 users table by email pattern.
 *
 *   # pinned users (counters accumulate across runs): snapshot before, report after
 *   node --experimental-strip-types scripts/release/upload-budget.ts --env qa \
 *     --emails 'test-%-1795000000001@e2e.alummahnow.net' --snapshot "$RUNNER_TEMP/uploads.json"
 *   node --experimental-strip-types scripts/release/upload-budget.ts --env qa \
 *     --emails 'test-%-1795000000001@e2e.alummahnow.net' --baseline "$RUNNER_TEMP/uploads.json" --max 40
 *
 *   # a release run's own throwaway users (E2E_RUN_TAG in their email): no baseline needed
 *   node --experimental-strip-types scripts/release/upload-budget.ts --env qa --emails '%-g123a1-%' --max 40
 *
 * Informational: over --max prints a warning annotation, never fails the job.
 * Needs D1 read on the account (CLOUDFLARE_API_TOKEN, or locally `wrangler login`);
 * without it, prints a warning and exits 0.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCfClient, d1Query, type CfClient } from './cf-api.ts';

export type UploadEnv = 'qa' | 'stage';

/** D1 database ids (apps/api-videos/wrangler.qa.jsonc and the stage env of wrangler.jsonc). Never production. */
export const DATABASES: Record<UploadEnv, { auth: string; search: string }> = {
	qa: { auth: '28590f3c-dd92-4c26-a803-d73a9bbe2b58', search: '0282bac3-5b70-4343-a991-937c732d981a' },
	stage: { auth: 'c7886ef6-c70b-4b7f-a65b-3df9f9aba9e2', search: '956a3550-bd20-4cfc-9bf2-b1c2265b33dd' },
};

export const OPERATIONS = ['video_upload_session', 'video_upload_continue'] as const;
export type Operation = (typeof OPERATIONS)[number];

export interface CounterRow {
	user_id: string;
	operation: string;
	window_start: number;
	count: number;
}

/** user → operation → { window_start, count } (day windows) */
export type Snapshot = Record<string, Partial<Record<Operation, { window_start: number; count: number }>>>;

export function toSnapshot(rows: CounterRow[]): Snapshot {
	const out: Snapshot = {};
	for (const row of rows) {
		if (!(OPERATIONS as readonly string[]).includes(row.operation)) continue;
		(out[row.user_id] ??= {})[row.operation as Operation] = { window_start: row.window_start, count: row.count };
	}
	return out;
}

export interface UploadDelta {
	sessions: number;
	continues: number;
	users: number;
	byUser: { userId: string; sessions: number; continues: number }[];
}

/**
 * Uploads since the baseline. A day window that started after the baseline's
 * (the run crossed midnight UTC) counts in full: the counter restarted.
 */
export function uploadDelta(current: Snapshot, baseline: Snapshot = {}): UploadDelta {
	const byUser: UploadDelta['byUser'] = [];
	for (const [userId, ops] of Object.entries(current)) {
		const d = { userId, sessions: 0, continues: 0 };
		for (const op of OPERATIONS) {
			const now = ops[op];
			if (!now) continue;
			const before = baseline[userId]?.[op];
			const n = before && before.window_start === now.window_start ? Math.max(0, now.count - before.count) : now.count;
			if (op === 'video_upload_session') d.sessions += n;
			else d.continues += n;
		}
		if (d.sessions || d.continues) byUser.push(d);
	}
	byUser.sort((a, b) => b.sessions - a.sessions);
	return {
		sessions: byUser.reduce((n, u) => n + u.sessions, 0),
		continues: byUser.reduce((n, u) => n + u.continues, 0),
		users: byUser.length,
		byUser,
	};
}

/** The literal text before a LIKE pattern's first wildcard. */
export function likePrefix(pattern: string): string {
	const i = pattern.search(/[%_]/);
	return i < 0 ? pattern : pattern.slice(0, i);
}

/** SQL LIKE semantics (ASCII case-insensitive, % any run, _ one character) as a predicate. */
export function likeMatcher(pattern: string): (value: string) => boolean {
	const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
	const re = new RegExp(`^${source}$`, 'i');
	return (value) => re.test(value);
}

export function parseArgs(argv: string[]) {
	const get = (name: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const env = (get('env') ?? 'qa') as UploadEnv;
	if (env !== 'qa' && env !== 'stage') throw new Error(`--env must be qa or stage (got ${env})`);
	const emails = get('emails');
	if (!emails || !/^[A-Za-z0-9%_.@+-]{3,120}$/.test(emails)) throw new Error('--emails needs a SQL LIKE pattern of the run\'s users (letters, digits, % _ . @ + -)');
	const maxRaw = get('max');
	const max = maxRaw === undefined ? undefined : Number(maxRaw);
	if (max !== undefined && (!Number.isInteger(max) || max < 0)) throw new Error('--max must be a non-negative integer');
	return { env, emails, snapshot: get('snapshot'), baseline: get('baseline'), max, label: get('label') ?? emails };
}

async function readCounters(cf: CfClient, env: UploadEnv, emailPattern: string): Promise<Snapshot> {
	const db = DATABASES[env];
	// D1 refuses LIKE patterns over 50 bytes ("LIKE or GLOB pattern too complex"), and a run's pattern
	// (e2e+<run>-<attempt>-web-<project>-%@e2e.alummahnow.net) is longer: range-scan the literal prefix
	// and match the whole pattern here
	const prefix = likePrefix(emailPattern);
	const candidates = await d1Query<{ id: string; email: string }>(cf, db.auth, 'SELECT id, email FROM users WHERE email >= ? AND email < ? LIMIT 5000', [prefix, `${prefix}\uffff`]);
	const matches = likeMatcher(emailPattern);
	const users = candidates.filter((u) => matches(u.email));
	const rows: CounterRow[] = [];
	for (let i = 0; i < users.length; i += 90) {
		const ids = users.slice(i, i + 90).map((u) => u.id);
		rows.push(
			...(await d1Query<CounterRow>(
				cf,
				db.search,
				`SELECT user_id, operation, window_start, count FROM upload_rate_windows
				 WHERE period = 'day' AND operation IN ('video_upload_session', 'video_upload_continue')
				 AND user_id IN (${ids.map(() => '?').join(',')})`,
				ids,
			)),
		);
	}
	return toSnapshot(rows);
}

export function formatReport(label: string, env: UploadEnv, delta: UploadDelta, max?: number): string[] {
	const lines = [
		`[uploads] ${env} ${label}: ${delta.sessions} upload session(s), ${delta.continues} resumed, ${delta.users} user(s)${max !== undefined ? ` (budget ${max})` : ''}`,
	];
	for (const u of delta.byUser.slice(0, 15)) lines.push(`  ${u.userId}: ${u.sessions} session(s), ${u.continues} resumed`);
	return lines;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	let cf: CfClient;
	let current: Snapshot;
	try {
		cf = createCfClient();
		current = await readCounters(cf, args.env, args.emails);
	} catch (error) {
		console.log(`::warning::upload budget not checked: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (args.snapshot) {
		writeFileSync(resolve(args.snapshot), JSON.stringify(current));
		console.log(`[uploads] snapshot of ${Object.keys(current).length} user(s) written`);
		return;
	}
	const baseline: Snapshot = args.baseline ? (JSON.parse(readFileSync(resolve(args.baseline), 'utf8')) as Snapshot) : {};
	const delta = uploadDelta(current, baseline);
	const lines = formatReport(args.label, args.env, delta, args.max);
	for (const line of lines) console.log(line);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Uploads (${args.env})\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
	if (args.max !== undefined && delta.sessions > args.max) {
		console.log(`::warning::${delta.sessions} upload sessions on ${args.env} this run, over the budget of ${args.max}: every upload with bytes is a Bunny encode in the shared QA/stage library`);
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	main().catch((error) => {
		console.log(`::warning::upload budget failed: ${error instanceof Error ? error.message : String(error)}`);
	});
}
