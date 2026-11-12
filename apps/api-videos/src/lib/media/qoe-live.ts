/**
 * Live playback quality (docs/admin/LIVE_OPS.md, Delivery page "last 60
 * minutes" and "now"): player heartbeats' deltas go to the realtime worker's
 * `qoe-live` object (VIEW_COUNTER binding: same WebSocketDurableObject class),
 * which sums them per minute in its own storage and pushes admin:media `qoe`
 * events. Nothing here writes D1; the daily rollup stays one upsert per
 * session (qoe.ts).
 */
import { logger } from '../logger';

export const QOE_LIVE_OBJECT = 'qoe-live';

export interface QoeLiveDelta {
	attempt?: boolean;
	started?: boolean;
	startupMs?: number;
	watchMs?: number;
	rebufferMs?: number;
	rebuffers?: number;
	/** Average kbps over this delta's watch time */
	avgKbps?: number;
	errored?: boolean;
	fallback?: boolean;
}

export interface QoeLiveBeat {
	sessionId: string;
	source: 'bunny' | 'r2';
	serving: 'bunny' | 'r2';
	playing: boolean;
	ended?: boolean;
	live: QoeLiveDelta;
}

/** The object's beat shape (websocket-server qoe-live.ts): flags as 0/1, bitrate as kbps × seconds. */
export function toObjectBeat(b: QoeLiveBeat) {
	const d = b.live;
	const watchMs = Math.max(0, d.watchMs ?? 0);
	return {
		sessionId: b.sessionId,
		source: b.source,
		serving: b.serving,
		playing: b.playing,
		...(b.ended ? { ended: true } : {}),
		d: {
			...(d.attempt ? { attempt: 1 } : {}),
			...(d.started ? { started: 1, startupMs: Math.max(0, d.startupMs ?? 0) } : {}),
			watchMs,
			rebufferMs: Math.max(0, d.rebufferMs ?? 0),
			rebuffers: Math.max(0, d.rebuffers ?? 0),
			kbpsWatchS: d.avgKbps && watchMs ? d.avgKbps * (watchMs / 1000) : 0,
			...(d.errored ? { errored: 1 } : {}),
			...(d.fallback ? { fallback: 1 } : {}),
		},
	};
}

type Namespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: string, init?: RequestInit): Promise<Response> } };

function stubOf(env: { VIEW_COUNTER?: unknown }) {
	const ns = env.VIEW_COUNTER as Namespace | undefined;
	return ns ? ns.get(ns.idFromName(QOE_LIVE_OBJECT)) : null;
}

/** Sends one heartbeat to the live object. Never throws (the live view is best effort). */
export async function recordQoeLive(env: { VIEW_COUNTER?: unknown }, beat: QoeLiveBeat): Promise<void> {
	const stub = stubOf(env);
	if (!stub) return;
	try {
		const res = await stub.fetch('http://qoe-live/qoe/beats', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ beats: [toObjectBeat(beat)] }),
		});
		if (!res.ok) logger.warn('[QoE live] Beat refused', { status: res.status });
	} catch (error) {
		logger.warn('[QoE live] Beat not delivered', { error: error instanceof Error ? error.message : String(error) });
	}
}

/** The last `minutes` minutes per provider and the plays now, or null when the object cannot be read. */
export async function readQoeLive(env: { VIEW_COUNTER?: unknown }, minutes = 60): Promise<unknown | null> {
	const stub = stubOf(env);
	if (!stub) return null;
	try {
		const res = await stub.fetch(`http://qoe-live/qoe/recent?minutes=${Math.max(1, Math.min(Math.floor(minutes) || 60, 2880))}`);
		return res.ok ? await res.json() : null;
	} catch (error) {
		logger.warn('[QoE live] Read failed', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
