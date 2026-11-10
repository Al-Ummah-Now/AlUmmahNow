/**
 * Socket shards and the topic router.
 *
 * Connections are spread over SOCKET_SHARDS objects of WebSocketDurableObject,
 * named `sockets:<n>`. A socket lands on a random shard and keeps the client
 * protocol unchanged (one socket, subscribe by message).
 *
 * Broadcasts are routed by topic: each channel has a directory object
 * `topic:<channel>` that knows which shards hold a subscriber of it (a shard
 * joins before it confirms the first local subscription). A broadcast goes to
 * the channel's directory, which forwards it to those shards only. Stale
 * entries are dropped lazily, when a shard answers that it no longer holds the
 * channel.
 *
 * Every shard instead takes the broadcast when that is cheaper (a batch with
 * more channels than there are shards), when a directory does not answer, and
 * while any shard cannot vouch that its channels are all in the directories
 * (a shard still on older code during a rollout, or a failed join): see
 * topicRoutingReady.
 *
 * The class stays WebSocketDurableObject: the release ships with
 * `wrangler versions upload`, which cannot add Durable Object classes. The same
 * class also hosts the view counter under `views:<videoId>:<shard>`.
 */

export const DEFAULT_SOCKET_SHARDS = 8;
/** Tells an internal request which shard it is for (set by the Worker, never taken from clients). */
export const SHARD_HEADER = 'X-Socket-Shard';
const SHARD_NAME = /^sockets:\d{1,2}$/;
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

export function isSocketShardName(name: string): boolean {
	return SHARD_NAME.test(name);
}

/** Directory object of a channel. */
export function topicName(channel: string): string {
	return `topic:${channel}`;
}

/** An internal request to a shard; it carries the shard's name so the shard can join directories. */
export function shardRequest(name: string, path: string, init: { method?: string; body?: string } = {}): Request {
	const headers: Record<string, string> = { [SHARD_HEADER]: name };
	if (init.body !== undefined) headers['Content-Type'] = 'application/json';
	return new Request(`http://internal${path}`, { ...init, headers });
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
			const res = await ns.get(ns.idFromName(name)).fetch(shardRequest(name, '/broadcast', { method: 'POST', body }));
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
			const res = await ns.get(ns.idFromName(name)).fetch(shardRequest(name, path));
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

const READY_TTL_MS = 30_000;
const NOT_READY_TTL_MS = 10_000;
const readiness = new WeakMap<ShardNamespace, { shards: number; ready: boolean; until: number; probe?: Promise<boolean> }>();

/**
 * True when every shard says all its channels are in the directories, so a
 * directory's shard list is complete. Probed at most every 30 s per isolate
 * (10 s while not ready). A shard on older code answers the probe with an
 * error, so a rollout falls back to every-shard broadcasts until the last
 * shard runs this code.
 */
export async function topicRoutingReady(
	ns: ShardNamespace,
	env: { SOCKET_SHARDS?: number | string },
	now = Date.now(),
): Promise<boolean> {
	// No namespace bound (a worker without the binding, or a unit test): never topic routing
	if (!ns || typeof ns !== 'object') return false;
	const shards = socketShardCount(env);
	const cached = readiness.get(ns);
	if (cached && cached.shards === shards) {
		if (now < cached.until) return cached.ready;
		if (cached.probe) return cached.probe;
	}
	const probe = readAllShards<{ ready?: boolean }>(ns, env, '/topic/ready')
		.then(({ bodies, failed }) => failed === 0 && bodies.length === shards && bodies.every((b) => b.ready === true))
		.catch(() => false)
		.then((ready) => {
			readiness.set(ns, { shards, ready, until: Date.now() + (ready ? READY_TTL_MS : NOT_READY_TTL_MS) });
			return ready;
		});
	readiness.set(ns, { shards, ready: cached?.ready ?? false, until: 0, probe });
	return probe;
}

/**
 * Delivers broadcast items: through each channel's directory to the shards
 * that hold it, or to every shard (see the header comment for when).
 */
export async function routeBroadcast(
	ns: ShardNamespace,
	env: { SOCKET_SHARDS?: number | string },
	items: BroadcastItem[],
): Promise<FanOutResult> {
	const byChannel = new Map<string, BroadcastItem[]>();
	for (const item of items) {
		const list = byChannel.get(item.channel);
		if (list) list.push(item);
		else byChannel.set(item.channel, [item]);
	}
	if (byChannel.size > socketShardCount(env) || !(await topicRoutingReady(ns, env))) {
		return broadcastToShards(ns, env, items);
	}
	const results = await Promise.all(
		[...byChannel].map(async ([channel, list]): Promise<FanOutResult> => {
			try {
				const res = await ns.get(ns.idFromName(topicName(channel))).fetch(
					new Request('http://internal/topic/route', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ channel, items: list }),
					}),
				);
				if (res.ok) return (await res.json()) as FanOutResult;
			} catch {
				// fall through
			}
			// The directory did not answer, so it delivered nothing: every shard takes these items
			return broadcastToShards(ns, env, list);
		}),
	);
	return results.reduce(
		(sum, r) => ({ shards: sum.shards + r.shards, failed: sum.failed + r.failed, delivered: sum.delivered + r.delivered }),
		{ shards: 0, failed: 0, delivered: 0 },
	);
}
