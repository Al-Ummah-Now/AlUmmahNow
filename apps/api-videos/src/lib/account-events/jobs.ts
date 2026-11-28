/**
 * Account events on their own queue (al-ummah-now-account-events[-qa|-stage], one message per invocation).
 *
 * The worker, not the endpoint, decides whether an event still applies: it takes the account in one conditional write
 * (store.ts claimUser), so an event older than the last one applied is ignored, also when an old one is retried after
 * a newer one finished, and nothing follows a purge. One event works on an account at a time (a lease), so a hide
 * that is still running and the restore after it never mix. An action is idempotent and resumable: it returns
 * `complete: false` with its progress when its budget runs out and goes on in the next message.
 *
 * A failure goes back to the queue with a backoff. After MAX_ATTEMPTS the event is marked failed and flagged on the
 * admin Errors page, whose Retry queues it again (POST /internal/account-events/retry). An event whose message was
 * lost is queued again by the hourly sweep.
 */
import { z } from 'zod';
import { reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { logger } from '../logger';
import type { AccountEventType, SetEnv } from './set';
import { claimUser, cleanReceived, markQueued, openEvents, readReceived, releaseUser, renewUser, reopen, saveProgress, settle, settleApplied, type ReceivedRow } from './store';

export interface AccountEventMessage {
	kind: 'account-event';
	jti: string;
}

interface QueueLike {
	send(message: AccountEventMessage, options?: { delaySeconds?: number }): Promise<unknown>;
}

export interface AccountEventsEnv extends SetEnv {
	SEARCH_DB?: D1Database;
	ACCOUNT_EVENTS_QUEUE?: QueueLike;
}

export interface ActionContext {
	userId: string;
	seq: number;
	reason: 'age' | 'deleted' | null;
	/** Where the last message stopped. */
	progress: string | null;
	/** Call between steps of a long action: false when the account is no longer ours, so stop. */
	keep(): Promise<boolean>;
}
export type AccountAction<E = AccountEventsEnv> = (env: E, ctx: ActionContext) => Promise<{ complete: boolean; progress?: string | null }>;
export type AccountActions = Partial<Record<Exclude<AccountEventType, 'verification'>, AccountAction>>;

/** What Videos does for each event. One that is not here is refused, so Auth keeps it. */
export const ACCOUNT_ACTIONS: AccountActions = {};

/** Deliveries before an event is marked failed (the consumer's max_retries is 5: six deliveries). */
export const MAX_ATTEMPTS = 6;
/** Longer than one queue invocation may run (15 minutes), so a lease that ran out belongs to nobody. */
export const LEASE_MS = 16 * 60_000;
const BUSY_DELAY_S = 60;
const SWEEP_AFTER_MS = 60 * 60_000;
const PAGE = 100;
/** Settled events are kept this long; the account keeps its newest event, so a late repeat of it or of an older one is ignored. */
export const KEEP_MS = 35 * 24 * 60 * 60_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const accountEventKey = (jti: string) => `account-event:${jti}`;
export const isAccountEventQueue = (queue: string) => queue.startsWith('al-ummah-now-account-events');
const AccountEventBody = z.object({
	kind: z.literal('account-event'),
	jti: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
});
export const isAccountEventMessage = (body: unknown): body is AccountEventMessage =>
	AccountEventBody.safeParse(body).success;

export function dbOf(env: AccountEventsEnv): D1Database {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

/** Queues an event that is not done. */
export async function enqueue(env: AccountEventsEnv, jti: string, now = Date.now(), delaySeconds = 0): Promise<void> {
	if (!env.ACCOUNT_EVENTS_QUEUE) throw new Error('ACCOUNT_EVENTS_QUEUE is not bound');
	await env.ACCOUNT_EVENTS_QUEUE.send({ kind: 'account-event', jti }, delaySeconds ? { delaySeconds } : undefined);
	await markQueued(dbOf(env), jti, now);
}

export type RunResult = 'applied' | 'ignored' | 'more' | 'busy' | 'skipped';

/** One run of one event. Throws when its action failed. */
export async function runAccountEvent(env: AccountEventsEnv, jti: string, actions: AccountActions = ACCOUNT_ACTIONS, now: () => number = Date.now): Promise<RunResult> {
	const db = dbOf(env);
	const row = await readReceived(db, jti);
	if (!row || row.status !== 'received') return 'skipped';
	const action = row.type === 'verification' ? undefined : actions[row.type];
	if (!action) throw new Error(`No action for ${row.type}`);
	const lease = crypto.randomUUID();
	const claim = await claimUser(db, row, lease, LEASE_MS, now());
	if (claim === 'busy') return 'busy';
	if (claim === 'old') {
		await settle(db, jti, 'ignored', now());
		return 'ignored';
	}
	try {
		const result = await action(env, {
			userId: row.user_id,
			seq: row.seq,
			reason: row.reason,
			progress: row.progress,
			keep: () => renewUser(db, row.user_id, lease, now() + LEASE_MS),
		});
		if (!result.complete) {
			await saveProgress(db, jti, result.progress ?? null);
			return 'more';
		}
		await settleApplied(db, row, lease, now());
		return 'applied';
	} finally {
		await releaseUser(db, row.user_id, lease);
	}
}

interface MessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export async function handleAccountEventBatch(
	batch: { messages: readonly MessageLike[] },
	env: AccountEventsEnv,
	ctx: ExecutionContextLike | undefined,
	actions: AccountActions = ACCOUNT_ACTIONS,
): Promise<void> {
	for (const msg of batch.messages) {
		if (!isAccountEventMessage(msg.body)) {
			logger.warn('[AccountEvents] Unknown message dropped');
			msg.ack();
			continue;
		}
		const { jti } = msg.body;
		try {
			const result = await runAccountEvent(env, jti, actions);
			// Goes on in a message of its own: neither is a failure, so neither uses up a retry
			if (result === 'more') await enqueue(env, jti);
			if (result === 'busy') await enqueue(env, jti, Date.now(), BUSY_DELAY_S);
			if (result === 'applied') resolveNeedsAction(env as unknown as ErrorReporterEnv, ctx, accountEventKey(jti));
			msg.ack();
		} catch (error) {
			logger.error('[AccountEvents] Event failed', { jti, attempts: msg.attempts, error: errorText(error) });
			if (msg.attempts < MAX_ATTEMPTS) {
				msg.retry({ delaySeconds: Math.min(30 * 2 ** (msg.attempts - 1), 900) });
				continue;
			}
			await giveUp(env, ctx, jti, errorText(error));
			msg.ack();
		}
	}
}

async function giveUp(env: AccountEventsEnv, ctx: ExecutionContextLike | undefined, jti: string, error: string): Promise<void> {
	let row: ReceivedRow | null = null;
	try {
		row = await readReceived(dbOf(env), jti);
		await settle(dbOf(env), jti, 'failed', Date.now(), error.slice(0, 300));
	} catch (markError) {
		logger.error('[AccountEvents] Could not mark the event failed', { jti, error: errorText(markError) });
	}
	reportNeedsAction('api-videos', env as unknown as ErrorReporterEnv, ctx, {
		key: accountEventKey(jti),
		source: 'queue',
		title: `Account event failed (${row?.type ?? 'unknown'})`,
		message: error,
		itemType: 'user',
		itemId: row?.user_id ?? jti,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/account-events/retry', body: { jti } },
		retryLabel: 'Try again',
		extra: { jti, type: row?.type ?? null },
	});
}

/** The admin's Retry of an event that gave up. False when there is nothing to retry. */
export async function retryAccountEvent(env: AccountEventsEnv, jti: unknown, ctx: ExecutionContextLike | undefined): Promise<boolean> {
	if (typeof jti !== 'string' || !(await reopen(dbOf(env), jti))) return false;
	await enqueue(env, jti);
	resolveNeedsAction(env as unknown as ErrorReporterEnv, ctx, accountEventKey(jti));
	return true;
}

/** Hourly: events whose message was lost go back on the queue; old settled ones are removed. */
export async function sweepAccountEvents(env: AccountEventsEnv, now = Date.now()): Promise<{ queued: number; removed: number }> {
	if (!env.ACCOUNT_EVENTS_QUEUE) return { queued: 0, removed: 0 };
	const db = dbOf(env);
	const open = await openEvents(db, now - SWEEP_AFTER_MS, PAGE);
	for (const jti of open) await enqueue(env, jti, now);
	return { queued: open.length, removed: await cleanReceived(db, now - KEEP_MS, PAGE) };
}
