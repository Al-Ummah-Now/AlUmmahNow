/**
 * State the test collector and test rail keep between calls, so they behave like a real vendor
 * (a refund can't exceed its payment, a payout keeps its status). Unit tests use the memory store;
 * the local stack and QA use the search D1 table `support_test_state` (migration 0076). Production
 * never gets a store: the test adapters refuse to run without one.
 */
export interface TestStateStore {
	get<T>(key: string): Promise<T | null>;
	put<T>(key: string, value: T): Promise<void>;
	list<T>(prefix: string): Promise<T[]>;
}

export function memoryTestState(): TestStateStore & { dump(): Record<string, unknown> } {
	const map = new Map<string, string>();
	return {
		async get<T>(key: string) {
			const v = map.get(key);
			return v === undefined ? null : (JSON.parse(v) as T);
		},
		async put<T>(key: string, value: T) {
			map.set(key, JSON.stringify(value));
		},
		async list<T>(prefix: string) {
			return [...map.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => JSON.parse(v) as T);
		},
		dump: () => Object.fromEntries([...map.entries()].map(([k, v]) => [k, JSON.parse(v)])),
	};
}

/** SHA-256 hex of a string: deterministic vendor ids derived from idempotency keys. */
export async function sha256Hex(text: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
