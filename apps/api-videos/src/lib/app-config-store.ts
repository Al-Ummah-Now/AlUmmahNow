/**
 * The APP_CONFIG KV namespace (Epic 9.3/9.5): one JSON document per key, read
 * with a 60 s per-isolate cache on top of KV's own 60 s edge cache. Validation
 * lives with each document's schema (lib/app-config.ts, lib/feature-flags.ts).
 */

export const APP_CONFIG_KEYS = ['flags', 'config', 'versions'] as const;
export type AppConfigKey = (typeof APP_CONFIG_KEYS)[number];

const ISOLATE_TTL_MS = 60_000;
const caches = new WeakMap<KVNamespace, Map<string, { at: number; value: unknown }>>();

/** Raw document from KV (null when missing); cached for 60 s per isolate. */
export async function readAppConfigDocument(kv: KVNamespace | undefined, key: AppConfigKey, now = Date.now()): Promise<unknown> {
	if (!kv) return null;
	let cache = caches.get(kv);
	if (!cache) caches.set(kv, (cache = new Map()));
	const hit = cache.get(key);
	if (hit && now - hit.at < ISOLATE_TTL_MS) return hit.value;
	const value = await kv.get(key, { type: 'json', cacheTtl: 60 });
	cache.set(key, { at: now, value });
	return value;
}

/** Drop this isolate's cached copy (after a write; other isolates refresh within 60 s). */
export function forgetAppConfigDocument(kv: KVNamespace, key: AppConfigKey): void {
	caches.get(kv)?.delete(key);
}
