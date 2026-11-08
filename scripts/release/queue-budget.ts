/**
 * Queue budget check (Cloudflare Queues analytics). Fails when, in a time window,
 *   - the videos queue took more writes per minute than the budget, or
 *   - any message was written to the DLQ.
 *
 *   node --experimental-strip-types scripts/release/queue-budget.ts --env qa \
 *     [--since 2026-11-08T20:00:00Z] [--minutes 60] [--max-writes-per-minute 600] [--max-dlq-writes 0]
 *
 * Why: QA's videos queue took ~350k writes a day while production took ~550,
 * because every read endpoint enqueued a "view" message and every channel-tab
 * save was retried into the DLQ. Nothing noticed for days. Run after E2E so a
 * regression shows up on the run that caused it.
 *
 * Needs a token with Account Analytics read (CLOUDFLARE_API_TOKEN, or locally
 * the `wrangler login` OAuth token). Without that permission it prints a
 * warning and exits 0: the check is informational until CI's token has it.
 */
import { resolve } from 'node:path';
import { CfApiError, cfToken, createCfClient, type CfClient } from './cf-api.ts';

export type QueueEnv = 'qa' | 'stage' | 'production';

export function queueNames(env: QueueEnv): { videos: string; dlq: string } {
	const suffix = env === 'production' ? '' : `-${env}`;
	return { videos: `al-ummah-now-videos${suffix}`, dlq: `al-ummah-now-dlq${suffix}` };
}

export interface BudgetInput {
	windowMinutes: number;
	videosWrites: number;
	dlqWrites: number;
	maxWritesPerMinute: number;
	maxDlqWrites: number;
}

export interface BudgetResult {
	ok: boolean;
	writesPerMinute: number;
	problems: string[];
}

export function evaluateBudget(input: BudgetInput): BudgetResult {
	const writesPerMinute = input.windowMinutes > 0 ? input.videosWrites / input.windowMinutes : 0;
	const problems: string[] = [];
	if (writesPerMinute > input.maxWritesPerMinute) {
		problems.push(`videos queue: ${writesPerMinute.toFixed(1)} writes/min over ${input.windowMinutes} min exceeds the budget of ${input.maxWritesPerMinute}/min`);
	}
	if (input.dlqWrites > input.maxDlqWrites) {
		problems.push(`DLQ: ${input.dlqWrites} message(s) dead-lettered (allowed ${input.maxDlqWrites}); see GET /dlq on the processor or the dead_letters table`);
	}
	return { ok: problems.length === 0, writesPerMinute, problems };
}

export function parseArgs(argv: string[], now = Date.now()) {
	const get = (name: string) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const env = (get('env') ?? 'qa') as QueueEnv;
	if (!['qa', 'stage', 'production'].includes(env)) throw new Error(`--env must be qa, stage or production (got ${env})`);
	const since = get('since');
	const minutes = Number(get('minutes') ?? 60);
	const from = since ? Date.parse(since) : now - minutes * 60_000;
	if (Number.isNaN(from) || from >= now) throw new Error(`invalid window start: ${since ?? minutes}`);
	return {
		env,
		from: new Date(from),
		to: new Date(now),
		maxWritesPerMinute: Number(get('max-writes-per-minute') ?? 600),
		maxDlqWrites: Number(get('max-dlq-writes') ?? 0),
	};
}

async function queueId(cf: CfClient, name: string): Promise<string | null> {
	const queues = await cf.request<{ queue_id: string; queue_name: string }[]>('GET', '/queues?per_page=100');
	return queues.find((q) => q.queue_name === name)?.queue_id ?? null;
}

/** WriteMessage count for one queue in [from, to). */
async function writes(token: string, accountId: string, id: string, from: Date, to: Date): Promise<number> {
	const query = `query($account: String!, $queue: String!, $from: Time!, $to: Time!) {
		viewer { accounts(filter: { accountTag: $account }) {
			queueMessageOperationsAdaptiveGroups(limit: 10, filter: { queueId: $queue, actionType: "WriteMessage", datetime_geq: $from, datetime_lt: $to }) { count }
		} }
	}`;
	const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables: { account: accountId, queue: id, from: from.toISOString(), to: to.toISOString() } }),
	});
	const json = (await res.json().catch(() => ({}))) as {
		data?: { viewer?: { accounts?: { queueMessageOperationsAdaptiveGroups?: { count: number }[] }[] } };
		errors?: { message: string }[] | null;
	};
	if (!res.ok || json.errors?.length) {
		throw new CfApiError(res.status === 200 ? 403 : res.status, `GraphQL: ${json.errors?.map((e) => e.message).join('; ') || res.statusText}`);
	}
	return (json.data?.viewer?.accounts?.[0]?.queueMessageOperationsAdaptiveGroups ?? []).reduce((sum, g) => sum + g.count, 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const names = queueNames(args.env);
	const token = cfToken();
	if (!token) {
		process.stdout.write('::warning::Queue budget check skipped: no Cloudflare credentials\n');
		process.exit(0);
	}
	const cf = createCfClient();
	try {
		const [videosId, dlqId] = await Promise.all([queueId(cf, names.videos), queueId(cf, names.dlq)]);
		if (!videosId || !dlqId) throw new Error(`queue not found: ${!videosId ? names.videos : names.dlq}`);
		const [videosWrites, dlqWrites] = await Promise.all([
			writes(token, cf.accountId, videosId, args.from, args.to),
			writes(token, cf.accountId, dlqId, args.from, args.to),
		]);
		const windowMinutes = (args.to.getTime() - args.from.getTime()) / 60_000;
		const result = evaluateBudget({ windowMinutes, videosWrites, dlqWrites, maxWritesPerMinute: args.maxWritesPerMinute, maxDlqWrites: args.maxDlqWrites });
		process.stdout.write(
			`Queue budget (${args.env}, ${args.from.toISOString()} -> ${args.to.toISOString()}, ${windowMinutes.toFixed(0)} min)\n` +
				`  ${names.videos}: ${videosWrites} writes (${result.writesPerMinute.toFixed(1)}/min, budget ${args.maxWritesPerMinute}/min)\n` +
				`  ${names.dlq}: ${dlqWrites} writes (allowed ${args.maxDlqWrites})\n`
		);
		if (!result.ok) {
			process.stderr.write(`Queue budget exceeded:\n${result.problems.map((p) => `  - ${p}`).join('\n')}\n`);
			process.exit(1);
		}
	} catch (error) {
		if (error instanceof CfApiError && (error.status === 401 || error.status === 403)) {
			process.stdout.write(`::warning::Queue budget check skipped: the Cloudflare token cannot read queue analytics (${error.message})\n`);
			process.exit(0);
		}
		throw error;
	}
}
