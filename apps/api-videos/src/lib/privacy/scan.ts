/**
 * Bounded R2 scanning for privacy operations (GDPR export / erasure / retention).
 *
 * Most buckets have no per-user index, so finding a user's objects means
 * listing whole buckets. Every R2 call is charged to an OperationBudget so a
 * single request stays inside the Workers subrequest limit; when the budget
 * runs out the operation reports `complete: false` and can be called again
 * (all privacy operations are idempotent).
 */

/** Minimal R2 surface used here (satisfied by R2Bucket and the test MemoryBucket). */
export interface BucketLike {
	get(key: string): Promise<{ json<T = unknown>(): Promise<T> } | null>;
	put(key: string, value: string, options?: unknown): Promise<unknown>;
	delete(keys: string | string[]): Promise<void>;
	list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
		objects: Array<{ key: string; uploaded?: Date }>;
		truncated: boolean;
		cursor?: string;
	}>;
}

export class BudgetExhausted extends Error {
	constructor() {
		super('Privacy operation budget exhausted');
		this.name = 'BudgetExhausted';
	}
}

export class OperationBudget {
	private used = 0;
	constructor(private readonly limit: number) {}

	spend(count = 1): void {
		if (this.used + count > this.limit) throw new BudgetExhausted();
		this.used += count;
	}

	get spent(): number {
		return this.used;
	}

	get remaining(): number {
		return Math.max(0, this.limit - this.used);
	}
}

/** Default subrequest budget per HTTP request (Workers allows 1000 on the paid plan). */
export const DEFAULT_OPERATION_BUDGET = 900;

export function asBucket(bucket: unknown): BucketLike {
	return bucket as BucketLike;
}

/** Iterate every key under `prefix`, charging one operation per list page. */
export async function* listKeys(
	bucket: BucketLike,
	budget: OperationBudget,
	prefix?: string,
): AsyncGenerator<{ key: string; uploaded?: Date }> {
	let cursor: string | undefined;
	do {
		budget.spend();
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const object of page.objects) yield object;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

export async function readJson<T>(bucket: BucketLike, key: string, budget: OperationBudget): Promise<T | null> {
	budget.spend();
	const object = await bucket.get(key);
	if (!object) return null;
	try {
		return await object.json<T>();
	} catch {
		return null;
	}
}

export async function writeJson(bucket: BucketLike, key: string, value: unknown, budget: OperationBudget): Promise<void> {
	budget.spend();
	await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

/** Delete keys in batches of up to 1000 (one operation per batch). */
export async function deleteKeys(bucket: BucketLike, keys: string[], budget: OperationBudget): Promise<number> {
	let deleted = 0;
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000);
		budget.spend();
		await bucket.delete(batch.length === 1 ? batch[0] : batch);
		deleted += batch.length;
	}
	return deleted;
}
