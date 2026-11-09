/**
 * Conditional read-modify-write of one R2 JSON object (SCALABILITY-AUDIT AA-1..3, AA-5).
 *
 * admin-api edits documents that api-videos, the scheduler and the processor
 * write too (video JSON with embedded comments, channels, playlists,
 * translations). A blind GET → change → PUT silently undid whatever another
 * writer stored in between (a moderation ban reverted by an owner's edit, a
 * new comment dropped by a reviewer's hide). Here the PUT only succeeds when
 * the object still has the etag that was read (`onlyIf.etagMatches`, or
 * create-only for a missing object); otherwise it re-reads and re-applies the
 * change to the newer copy.
 */

export interface CasObject {
	etag: string;
	text(): Promise<string>;
}

export interface CasBucket {
	get(key: string): Promise<CasObject | null>;
	put(key: string, value: string, options?: unknown): Promise<unknown>;
}

export class ConcurrentUpdateError extends Error {
	constructor(key: string, attempts: number) {
		super(`Concurrent updates to ${key}: gave up after ${attempts} attempts`);
		this.name = 'ConcurrentUpdateError';
	}
}

export interface CasResult<T> {
	/** The stored value (the current one when nothing was written). */
	value: T;
	written: boolean;
	/** R2 `uploaded` time of the write (epoch ms), the version for the search index. */
	version?: number;
}

/**
 * Applies `mutate` to the current value of `key` and writes it conditionally,
 * retrying on a concurrent change. `mutate` gets the current value (null when
 * missing) and returns the new value, or `undefined` to write nothing.
 * Resolves to null when the object is missing and `mutate` declined to create it.
 */
export async function updateJson<T>(
	bucket: CasBucket,
	key: string,
	mutate: (current: T | null) => T | undefined | Promise<T | undefined>,
	opts: { maxAttempts?: number; contentType?: string; pretty?: boolean } = {},
): Promise<CasResult<T> | null> {
	const maxAttempts = opts.maxAttempts ?? 12;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const object = await bucket.get(key);
		const current = object ? (JSON.parse(await object.text()) as T) : null;
		const next = await mutate(current);
		if (next === undefined) return current === null ? null : { value: current, written: false };
		const body = opts.pretty ? JSON.stringify(next, null, 2) : JSON.stringify(next);
		const written = (await bucket.put(key, body, {
			httpMetadata: { contentType: opts.contentType ?? 'application/json' },
			onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
		})) as { uploaded?: Date | string } | null;
		if (written) {
			const t = written.uploaded ? new Date(written.uploaded).getTime() : NaN;
			return { value: next, written: true, ...(Number.isFinite(t) ? { version: t } : {}) };
		}
		// Someone else wrote in between: back off (jittered, growing) and apply the change to their copy
		await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * 2 ** Math.min(attempt, 7)));
	}
	throw new ConcurrentUpdateError(key, maxAttempts);
}
