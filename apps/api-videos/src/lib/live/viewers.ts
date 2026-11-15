/**
 * People watching a live stream now (AlUmmahNow#30): the watch page's
 * heartbeats go to the realtime worker's `liveviewers:<streamId>` object
 * (VIEW_COUNTER binding: same WebSocketDurableObject class), which keeps them
 * in memory and answers the count. Nothing here writes D1, R2 or KV.
 */
import { logger } from '../logger';

export const liveViewersObject = (streamId: string) => `liveviewers:${streamId}`;

const VIEWER_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const isViewerId = (value: unknown): value is string => typeof value === 'string' && VIEWER_ID.test(value);

type Namespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: string, init?: RequestInit): Promise<Response> } };

function stubOf(env: { VIEW_COUNTER?: unknown }, streamId: string) {
	const ns = env.VIEW_COUNTER as Namespace | undefined;
	return ns ? ns.get(ns.idFromName(liveViewersObject(streamId))) : null;
}

const viewersOf = async (res: Response): Promise<number | null> => {
	if (!res.ok) return null;
	const body = (await res.json()) as { viewers?: unknown };
	return typeof body.viewers === 'number' ? body.viewers : null;
};

/** One heartbeat (or a tab leaving); the count now, or null when the object is unreachable. Never throws. */
/**
 * The network a heartbeat comes from, for the object's per-network cap: a hash of the client IP
 * and the stream (never the IP itself, and not linkable across streams).
 */
export async function viewerNet(ip: string | null | undefined, streamId: string): Promise<string> {
	if (!ip) return 'none';
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${streamId}|${ip}`));
	return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function beatLiveViewer(env: { VIEW_COUNTER?: unknown }, streamId: string, viewerId: string, leaving = false, net = 'none'): Promise<number | null> {
	const stub = stubOf(env, streamId);
	if (!stub) return null;
	try {
		return await viewersOf(
			await stub.fetch('http://live-viewers/live-viewers/beat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ viewerId, net, ...(leaving ? { leaving: true } : {}) }),
			}),
		);
	} catch (error) {
		logger.warn('[Live viewers] Beat not delivered', { streamId, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/** Who is watching now, or null when the object is unreachable. Never throws. */
export async function countLiveViewers(env: { VIEW_COUNTER?: unknown }, streamId: string): Promise<number | null> {
	const stub = stubOf(env, streamId);
	if (!stub) return null;
	try {
		return await viewersOf(await stub.fetch('http://live-viewers/live-viewers/count'));
	} catch (error) {
		logger.warn('[Live viewers] Count failed', { streamId, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
