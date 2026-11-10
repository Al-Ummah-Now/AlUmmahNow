/**
 * Socket shards.
 *
 * Connections are spread over SOCKET_SHARDS objects of WebSocketDurableObject,
 * named `sockets:<n>`. A socket lands on a random shard; every broadcast goes to
 * every shard, and each shard delivers only to its own subscribers. That keeps
 * the client protocol unchanged (one socket, subscribe by message) while no
 * single object carries every socket, every heartbeat and every broadcast.
 *
 * The class stays WebSocketDurableObject: the release ships with
 * `wrangler versions upload`, which cannot add Durable Object classes. The same
 * class also hosts the view counter under `views:<videoId>:<shard>`.
 */

export const DEFAULT_SOCKET_SHARDS = 8;
const MAX_SOCKET_SHARDS = 64;

/** Name of socket shard `n`. */
export function socketShardName(n: number): string {
	return `sockets:${n}`;
}

/** Number of socket shards. Changing it only moves new connections; broadcasts always reach every shard. */
export function socketShardCount(env: { SOCKET_SHARDS?: number | string }): number {
	const n = Number(env.SOCKET_SHARDS ?? DEFAULT_SOCKET_SHARDS);
	return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_SOCKET_SHARDS) : DEFAULT_SOCKET_SHARDS;
}

export function socketShardNames(env: { SOCKET_SHARDS?: number | string }): string[] {
	return Array.from({ length: socketShardCount(env) }, (_, i) => socketShardName(i));
}

/** Shards in a random order: the first one takes a new socket, the rest are tried when it is full. */
export function shardsInRandomOrder(env: { SOCKET_SHARDS?: number | string }): string[] {
	const names = socketShardNames(env);
	// Load spreading only, not a secret: an unbiased uniform pick is all that is needed
	const start = Math.floor(Math.random() * names.length);
	return [...names.slice(start), ...names.slice(0, start)];
}

export interface ShardNamespace {
	idFromName(name: string): DurableObjectId;
	get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

export interface BroadcastItem {
	channel: string;
	message: unknown;
}

export interface FanOutResult {
	shards: number;
	failed: number;
	delivered: number;
}

/**
 * Sends broadcast items to every socket shard (one request per shard, all items
 * in it). `delivered` is the number of sockets reached across shards.
 */
export async function broadcastToShards(
	ns: ShardNamespace,
	env: { SOCKET_SHARDS?: number | string },
	items: BroadcastItem[],
): Promise<FanOutResult> {
	const names = socketShardNames(env);
	const body = JSON.stringify({ items });
	const results = await Promise.allSettled(
		names.map(async (name) => {
			const res = await ns.get(ns.idFromName(name)).fetch(
				new Request('http://internal/broadcast', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body,
				}),
			);
			if (!res.ok) throw new Error(`shard ${name}: ${res.status}`);
			const json = (await res.json()) as { delivered?: number };
			return json.delivered ?? 0;
		}),
	);
	let failed = 0;
	let delivered = 0;
	for (const r of results) {
		if (r.status === 'fulfilled') delivered += r.value;
		else failed++;
	}
	return { shards: names.length, failed, delivered };
}

/** GETs `path` on every shard and returns the JSON bodies that came back. */
export async function readAllShards<T>(
	ns: ShardNamespace,
	env: { SOCKET_SHARDS?: number | string },
	path: string,
): Promise<{ bodies: T[]; failed: number }> {
	const results = await Promise.allSettled(
		socketShardNames(env).map(async (name) => {
			const res = await ns.get(ns.idFromName(name)).fetch(new Request(`http://internal${path}`));
			if (!res.ok) throw new Error(`shard ${name}: ${res.status}`);
			return (await res.json()) as T;
		}),
	);
	const bodies: T[] = [];
	let failed = 0;
	for (const r of results) {
		if (r.status === 'fulfilled') bodies.push(r.value);
		else failed++;
	}
	return { bodies, failed };
}
