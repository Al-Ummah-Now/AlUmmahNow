/**
 * Deletes every video the "Upload formats on QA" check made (.github/workflows/upload-formats-qa.yml),
 * whatever became of the test process: a killed or timed-out Playwright run, an expired session, a
 * cancelled workflow. An always() workflow step runs it after the test.
 *
 *   node --experimental-strip-types scripts/e2e/delete-format-videos.ts \
 *     --resources "$E2E_RUN_RESOURCES_FILE" --session "$FORMATS_SESSION_FILE"
 *
 * Reads the video ids the run recorded ("video <id>" lines, apps/web/e2e/release/builders.ts
 * recordResource) and the throwaway account's session (the refresh token the check keeps current and
 * the channel id), renews the access token (it lives 15 minutes on QA), and for every video moves it to
 * the trash and deletes it for good (the owner's two calls, with the Bunny video and R2 objects). All
 * at once (10), each request bounded, the whole run bounded to 2 minutes; a 404 counts as deleted. Empty
 * --resources or --session (the workflow was cancelled before they were set) is a note and exit 0.
 * What this step cannot delete is picked up after the run accounts' deletion that follows it: the
 * api-videos run-user sweep (every 10 minutes, lib/e2e/runUserSweep.ts) erases a deleted run account's
 * profile, channels and videos with their Bunny media; a run cancelled before that deletion leaves the
 * accounts to e2e-run-users-sweep.yml (hourly, older than 24 hours) and then the same sweep. Prints the counts, never
 * a token. Exit code 1 when a video could not be deleted (the leftover check then reports it too).
 * QA only: refuses any other API or auth host.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_API = 'https://videos.api.qa.alummahnow.net';
export const QA_AUTH = 'https://auth.qa.alummahnow.net';
/** The videos web app's OAuth client on QA (apps/web/e2e/release/builders.ts WEB_CLIENT_ID.qa) */
export const QA_WEB_CLIENT_ID = 'e0de3c30-0304-4ac4-86d6-1e185dec0439';
export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * After a cancel GitHub gives all always() steps about 5 minutes in total, and the run accounts' deletion
 * and the leftover check come after this step: so 10 videos at once (their two calls are sequential, 30 s
 * each at worst, so about a minute), 2 minutes in all, and a 3 minute step.
 */
export const RUN_BUDGET_MS = 2 * 60_000;
export const CONCURRENCY = 10;

/** The distinct video ids of a run resources file */
export function videoIdsOf(text: string): string[] {
	const ids = new Set<string>();
	for (const line of text.split('\n')) {
		const [kind, id] = line.trim().split(/\s+/);
		if (kind === 'video' && id && /^[A-Za-z0-9_-]{6,64}$/.test(id)) ids.add(id);
	}
	return [...ids];
}

export interface Deps {
	fetch: typeof fetch;
	log: (line: string) => void;
}

export interface Result {
	deleted: number;
	failed: number;
	notTried: number;
}

/** Runs `task` over `items`, `limit` at a time, until `deadline` (what is left is not tried) */
export async function inPool<T>(items: T[], limit: number, deadline: number, task: (item: T) => Promise<void>): Promise<number> {
	let next = 0;
	const worker = async () => {
		while (next < items.length && Date.now() < deadline) await task(items[next++] as T);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return items.length - next;
}

export async function run(opts: { resources: string; session: string }, deps: Deps): Promise<Result> {
	const ids = existsSync(opts.resources) ? videoIdsOf(readFileSync(opts.resources, 'utf8')) : [];
	if (ids.length === 0) {
		deps.log('[format-videos] no videos recorded: nothing to delete');
		return { deleted: 0, failed: 0, notTried: 0 };
	}
	if (!existsSync(opts.session)) {
		deps.log(`::error::${ids.length} video(s) recorded but no session file: they are left for the leftover check and the run-account sweep`);
		return { deleted: 0, failed: ids.length, notTried: 0 };
	}
	const { refreshToken, channelId } = JSON.parse(readFileSync(opts.session, 'utf8')) as { refreshToken?: string; channelId?: string };
	if (!refreshToken || !channelId) {
		deps.log(`::error::the session file has no refresh token or channel: ${ids.length} video(s) left`);
		return { deleted: 0, failed: ids.length, notTried: 0 };
	}
	const refreshed = await deps.fetch(`${QA_AUTH}/token`, {
		method: 'POST',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: QA_WEB_CLIENT_ID }),
	}).catch(() => null);
	const token = refreshed?.ok ? ((await refreshed.json().catch(() => ({}))) as { access_token?: string }).access_token : undefined;
	if (!token) {
		deps.log(`::error::the session could not be renewed (${refreshed ? `HTTP ${refreshed.status}` : 'no answer'}): ${ids.length} video(s) left`);
		return { deleted: 0, failed: ids.length, notTried: 0 };
	}
	let deleted = 0;
	let failed = 0;
	const call = (id: string, suffix: string) =>
		deps.fetch(`${QA_API}/api/videos/${encodeURIComponent(id)}${suffix}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: { Authorization: `Bearer ${token}`, channelId, 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' },
		});
	const notTried = await inPool(ids, CONCURRENCY, Date.now() + RUN_BUDGET_MS, async (id) => {
		try {
			// The trash first, then for good; a video already gone (404) is done
			for (const suffix of ['', '/permanent']) {
				const res = await call(id, suffix);
				if (!res.ok && res.status !== 404) throw new Error(`DELETE ${suffix || 'trash'} answered ${res.status}`);
			}
			deleted++;
		} catch (error) {
			failed++;
			deps.log(`[format-videos] ${id}: ${(error as Error).message}`);
		}
	});
	deps.log(`[format-videos] ${ids.length} recorded: ${deleted} deleted, ${failed} failed, ${notTried} not tried`);
	if (notTried > 0) deps.log(`::error::${notTried} video(s) not tried: the cleanup ran out of time`);
	return { deleted, failed, notTried };
}

/** The value of --name, '' when it is missing or empty */
export function arg(name: string, argv: string[] = process.argv): string {
	const i = argv.indexOf(name);
	return (i >= 0 ? argv[i + 1] : undefined) ?? '';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	if (process.env.E2E_ENV !== 'qa') {
		process.stderr.write('delete-format-videos: E2E_ENV must be qa\n');
		process.exit(1);
	}
	const resources = arg('--resources');
	const session = arg('--session');
	if (!resources || !session) {
		process.stdout.write('[format-videos] the run was cancelled before its files were set: nothing to delete\n');
		process.exit(0);
	}
	run({ resources, session }, { fetch, log: (line) => process.stdout.write(`${line}\n`) })
		.then((r) => process.exit(r.failed || r.notTried ? 1 : 0))
		.catch((error) => {
			process.stderr.write(`delete-format-videos: ${(error as Error).message}\n`);
			process.exit(1);
		});
}
