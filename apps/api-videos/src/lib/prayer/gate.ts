/**
 * The prayer provider gate (wiki Epic 21 §3 and §5.2): protects AlAdhan, which publishes no rate
 * limit or SLA, and protects us from it. It lives in the search D1 (search migration 0119), not a
 * Durable Object, because the release promotes api-videos with versions upload, which cannot
 * apply a Durable Object migration. It is touched only on a cache miss.
 *
 * - Lease per cache key: the first miss takes it; the others wait for the cache (coalescing).
 *   A lease expires after LEASE_MS and is taken over, so a dead isolate never wedges a key.
 * - Cap: at most `maxInFlight` live leases and `perSecond` starts in the current second.
 * - Backoff: after a 429/5xx, nothing starts before `next_allowed_ms` (Retry-After, else 2^n s).
 * - Breaker: OPEN_AFTER consecutive failures open it for OPEN_MS; after that one isolate claims
 *   the single half-open probe atomically; a success closes it.
 */

export const LEASE_MS = 15_000;
export const OPEN_AFTER = 5;
export const OPEN_MS = 60_000;
export const PROBE_MS = 10_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export interface GateLimits {
	maxInFlight: number;
	perSecond: number;
}

export const DEFAULT_GATE_LIMITS: GateLimits = { maxInFlight: 4, perSecond: 5 };

export type GateRefusal = 'busy' | 'circuit_open' | 'backoff' | 'over_cap';
export type GateResult = { ok: true; leaseId: string; probe: boolean } | { ok: false; reason: GateRefusal };

interface GateRow {
	window_start_ms: number;
	window_count: number;
	failures: number;
	open_until_ms: number;
	probe_until_ms: number;
	next_allowed_ms: number;
}

async function gateRow(db: D1Database, provider: string): Promise<GateRow> {
	await db.prepare('INSERT INTO prayer_provider_gate (provider, updated_at) VALUES (?, ?) ON CONFLICT (provider) DO NOTHING').bind(provider, new Date().toISOString()).run();
	const row = await db
		.prepare('SELECT window_start_ms, window_count, failures, open_until_ms, probe_until_ms, next_allowed_ms FROM prayer_provider_gate WHERE provider = ?')
		.bind(provider)
		.first<GateRow>();
	return row ?? { window_start_ms: 0, window_count: 0, failures: 0, open_until_ms: 0, probe_until_ms: 0, next_allowed_ms: 0 };
}

async function dropLease(db: D1Database, key: string, leaseId: string): Promise<void> {
	await db.prepare('DELETE FROM prayer_fetch_leases WHERE cache_key = ? AND lease_id = ?').bind(key, leaseId).run();
}

/** Asks to make one upstream call for `key`. On `ok`, call `release` afterwards, whatever happens. */
export async function acquire(db: D1Database, provider: string, key: string, limits: GateLimits, now = Date.now()): Promise<GateResult> {
	const gate = await gateRow(db, provider);
	let probe = false;
	if (gate.failures >= OPEN_AFTER) {
		if (gate.open_until_ms > now) return { ok: false, reason: 'circuit_open' };
		// Half-open: exactly one isolate claims the probe
		const claimed = await db
			.prepare(
				`UPDATE prayer_provider_gate SET probe_until_ms = ?, updated_at = ?
				 WHERE provider = ? AND failures >= ? AND open_until_ms <= ? AND probe_until_ms <= ? RETURNING provider`,
			)
			.bind(now + PROBE_MS, new Date(now).toISOString(), provider, OPEN_AFTER, now, now)
			.first();
		if (!claimed) return { ok: false, reason: 'circuit_open' };
		probe = true;
	} else if (gate.next_allowed_ms > now) {
		return { ok: false, reason: 'backoff' };
	}

	const leaseId = crypto.randomUUID();
	const lease = await db
		.prepare(
			`INSERT INTO prayer_fetch_leases (cache_key, lease_id, expires_at_ms) VALUES (?, ?, ?)
			 ON CONFLICT (cache_key) DO UPDATE SET lease_id = excluded.lease_id, expires_at_ms = excluded.expires_at_ms
			 WHERE prayer_fetch_leases.expires_at_ms <= ? RETURNING lease_id`,
		)
		.bind(key, leaseId, now + LEASE_MS, now)
		.first<{ lease_id: string }>();
	if (lease?.lease_id !== leaseId) {
		if (probe) await db.prepare('UPDATE prayer_provider_gate SET probe_until_ms = 0 WHERE provider = ?').bind(provider).run();
		return { ok: false, reason: 'busy' };
	}

	const live = await db.prepare('SELECT COUNT(*) AS n FROM prayer_fetch_leases WHERE expires_at_ms > ?').bind(now).first<{ n: number }>();
	const started = await db
		.prepare(
			`UPDATE prayer_provider_gate
			 SET window_start_ms = CASE WHEN window_start_ms + 1000 <= ?1 THEN ?1 ELSE window_start_ms END,
			     window_count = CASE WHEN window_start_ms + 1000 <= ?1 THEN 1 ELSE window_count + 1 END
			 WHERE provider = ?2 RETURNING window_count`,
		)
		.bind(now, provider)
		.first<{ window_count: number }>();
	if (Number(live?.n ?? 0) > limits.maxInFlight || Number(started?.window_count ?? 0) > limits.perSecond) {
		await dropLease(db, key, leaseId);
		if (probe) await db.prepare('UPDATE prayer_provider_gate SET probe_until_ms = 0 WHERE provider = ?').bind(provider).run();
		return { ok: false, reason: 'over_cap' };
	}
	return { ok: true, leaseId, probe };
}

export function backoffMs(failures: number, retryAfterMs: number | null): number {
	if (retryAfterMs !== null) return Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, retryAfterMs));
	return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, failures - 1));
}

/**
 * Ends a call. Success closes the breaker and clears backoff. A provider failure counts toward the
 * breaker and sets the next allowed start; a failed probe re-opens the breaker. Expired leases
 * are removed on the way (index on expires_at_ms).
 */
export async function release(
	db: D1Database,
	provider: string,
	key: string,
	leaseId: string,
	outcome: { ok: true } | { ok: false; retryAfterMs: number | null; counts: boolean },
	now = Date.now(),
): Promise<void> {
	const at = new Date(now).toISOString();
	const statements = [
		db.prepare('DELETE FROM prayer_fetch_leases WHERE cache_key = ? AND lease_id = ?').bind(key, leaseId),
		db.prepare('DELETE FROM prayer_fetch_leases WHERE expires_at_ms <= ?').bind(now),
	];
	const failure = outcome.ok ? null : (outcome as { ok: false; retryAfterMs: number | null; counts: boolean });
	if (!failure) {
		statements.push(
			db.prepare('UPDATE prayer_provider_gate SET failures = 0, open_until_ms = 0, probe_until_ms = 0, next_allowed_ms = 0, updated_at = ? WHERE provider = ?').bind(at, provider),
		);
	} else if (failure.counts) {
		const row = await gateRow(db, provider);
		const failures = row.failures + 1;
		const wait = backoffMs(failures, failure.retryAfterMs);
		statements.push(
			db
				.prepare('UPDATE prayer_provider_gate SET failures = ?, next_allowed_ms = ?, open_until_ms = ?, probe_until_ms = 0, updated_at = ? WHERE provider = ?')
				.bind(failures, now + wait, failures >= OPEN_AFTER ? now + OPEN_MS : 0, at, provider),
		);
	}
	await db.batch(statements);
}
