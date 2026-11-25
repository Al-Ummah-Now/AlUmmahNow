/**
 * Live stream sessions (D3): the same endpoints whichever provider serves the
 * stream (lib/live/*).
 *
 *   GET  /api/live-streams/:id          public stream (owner: everything)
 *   GET  /api/live-streams/:id/state    live state for Studio and the watch page
 *   GET  /api/live-streams/:id/ingest   owner: encoder settings (provisions a session)
 *   POST /api/live-streams/:id/start    owner: Go live
 *   POST /api/live-streams/:id/end      owner: End stream (VOD follows)
 *   DELETE /api/live-streams/:id        owner: delete (ends a session still open)
 *   POST /api/live-streams/:id/qoe      sampled player beacon
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { AppContext, AuthenticatedRoute, OptionalAuthRoute, PublicRoute } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { CHANNEL_SUSPENDED_CODE } from '../../middleware/auth';
import { liveStreamIsFrozen } from '../../lib/admin/frozen';
import { LiveProviderError } from '../../lib/live/providers';
import { LiveRefusedError } from '../../lib/live/service';
import { deleteStream, readStream, streamEnd, streamIngest, streamIsRemoved, streamStart, streamState, type LiveStreamRecord, type StreamsEnv } from '../../lib/live/streams';
import { readLiveRouting } from '../../lib/live/store';
import { parseBeacon, QoeRejected, recordBeacon } from '../../lib/live/qoe';
import { signLiveVodUrl } from '../../lib/live/vod-sign';
import { privateAnswer } from '../../lib/private-answer';
import { liveSessionAccess, signManagerUrl } from '../../lib/live/access';
import { canManageLiveStream } from '../../lib/channelAccess';
import { beatLiveViewer, countLiveViewers, isViewerId, viewerNet } from '../../lib/live/viewers';
import { isLiveVodWithheld, liveRecordingWithheld } from '@al-ummah/shared-types';
import { checkLiveTier, streamTierContext, type LiveTierOp } from '../../lib/live/tier-gate';
import type { SessionTier } from '../../lib/live/service';
import { featureOff } from '../../lib/features/off';
import { openTransferJob } from '../../lib/admin/service';
import { LIVE_TIER_ERROR_CODES, featureGate } from '@al-ummah/shared-types';
import { apiError } from '../../lib/api-error';
import { readChatStream } from '../../lib/live/chat';
import { reminderCounts, shownEventType, switchOn } from '../../lib/live/events';
import { hasReminder, remindable } from '../../lib/live/reminders';
import { cancelPremiere, endPremiere, isPremiere, startPremiere } from '../../lib/live/premieres';
import { chatState } from './liveChat';
import { PollAfterMs } from './pollAfter';

const Params = z.object({ id: Str({ description: 'Live stream id' }) });
const Ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: { 'application/json': { schema: z.object({ success: z.boolean(), result: schema }) } } });
const Err = (description: string) => ({ description, content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string().optional(), error: z.string() }) } } });

const env = (c: AppContext) => c.env as unknown as StreamsEnv;
const fail = (c: AppContext, status: number, code: string, error: string) => c.json({ success: false, code, error }, status as 400);

// Who may see a stream whose recording is held (VR9): shared, so its chat follows the same rule (wiki E17)
export { liveRecordingWithheld };

/** A held or rejected recording's URL never reaches anyone but the owner, whatever the stream does next. */
export function recordingHidden(s: object, isOwner: boolean): boolean {
	return !isOwner && isLiveVodWithheld((s as { review?: { status?: string } }).review);
}

/** Public fields of a stream; encoder settings never leave the owner endpoints. */
export function publicStream(s: LiveStreamRecord, isOwner: boolean) {
	const { streamKey: _k, rtmpUrl: _r, providerMove, isTest: _t, createdBy, likes, dislikes, comments, review, reviewShadow: _rs, reviewSessionId: _ri, liveAgainSessionId: _la, ...rest } = s as LiveStreamRecord & { likes?: unknown[]; dislikes?: unknown[]; comments?: unknown[]; createdBy?: string };
	return {
		...rest,
		// The recording's review is the owner's business (Studio shows it); the marker never leaves
		...(isOwner && review ? { review } : {}),
		...(recordingHidden(s, isOwner) ? { vodUrl: null } : {}),
		likesCount: Array.isArray(likes) ? likes.length : 0,
		dislikesCount: Array.isArray(dislikes) ? dislikes.length : 0,
		commentsCount: Array.isArray(comments) ? comments.length : 0,
		...(isOwner ? { providerMove: providerMove ?? null } : {}),
		// Which video a premiere shows is its team's unless it is on or over (wiki E17)
		...(!isOwner && s.status !== 'live' && s.status !== 'ended' ? { premiereVideoId: undefined } : {}),
		// What the AI scan holds in the chat is the team's business (E17-D4)
		...(isOwner ? {} : { aiHold: undefined }),
		// The channel member who created it, for those who manage the channel's live
		...(isOwner && createdBy ? { createdBy } : {}),
	};
}

async function visibleStream(c: AppContext, id: string, userId: string | undefined): Promise<LiveStreamRecord | Response> {
	const stream = await readStream(env(c), id);
	// The owner, or a channel member with live.manage (docs/specs/CHANNEL-ROLES.md)
	const isOwner = !!stream && !!userId && await canManageLiveStream(c.env as never, stream, userId);
	if (!stream || ((stream.isPrivate || stream.isHidden) && !isOwner)) return fail(c, 404, 'not_found', 'Live stream not found');
	// A scheduled premiere is its team's only while premieres are off (wiki E17 §3.1)
	if (!isOwner && isPremiere(stream) && stream.status === 'scheduled' && !(await switchOn(c, 'livePremieres'))) return fail(c, 404, 'not_found', 'Live stream not found');
	// A recording held for review (or rejected) reaches its owner only, like a held video (VR9)
	if (!isOwner && liveRecordingWithheld(stream)) return fail(c, 404, 'not_found', 'Live stream not found');
	return stream;
}

/** What the apps need beside the session (wiki E17): a premiere's clock and video, the schedule. */
function liveAppState(stream: LiveStreamRecord, manages: boolean) {
	const s = stream as LiveStreamRecord & { scheduledStartTime?: string };
	const base = { kind: isPremiere(stream) ? 'premiere' : 'live', scheduledStartTime: s.scheduledStartTime ?? null, premiereVideoId: null as string | null, durationSeconds: null as number | null };
	if (!isPremiere(stream)) return base;
	// Played as the video it is (GET /api/videos/:id/playback), at serverNow - startedAt
	return { ...base, premiereVideoId: manages || stream.status === 'live' || stream.status === 'ended' ? (stream.premiereVideoId ?? null) : null, durationSeconds: stream.durationSeconds ?? null, startedAt: stream.actualStartTime ?? null, endedAt: stream.actualEndTime ?? null, playbackUrl: null, vodUrl: null };
}

async function ownedStream(c: AppContext, id: string, userId: string): Promise<LiveStreamRecord | Response> {
	const stream = await readStream(env(c), id);
	if (!stream) return fail(c, 404, 'not_found', 'Live stream not found');
	if (!(await canManageLiveStream(c.env as never, stream, userId))) return fail(c, 403, 'forbidden', 'Insufficient permissions for this stream');
	return stream;
}

const rolesOf = (c: AppContext) => (c.get('auth') as { payload?: { roles?: string[] } } | undefined)?.payload?.roles;

/**
 * The channel owner's creator tier must include live (lib/live/tier-gate.ts): a refusal is
 * 403/402 with its code and the limit it hit; D1 not answering fails closed (503).
 */
export async function liveTierGate(c: AppContext, stream: Pick<LiveStreamRecord, 'id' | 'channelId' | 'userId' | 'sessionId'>, op: LiveTierOp, userId: string): Promise<SessionTier | Response> {
	const db = env(c).SEARCH_DB;
	if (!db) return {};
	try {
		const { ownerId, callerMayGoLive } = await streamTierContext(env(c), stream, userId);
		if (!callerMayGoLive) {
			logger.info('[Live] Caller no longer manages live on the stream\'s channel', { streamId: stream.id, op, channelId: stream.channelId ?? null });
			return c.json({ success: false, code: 'forbidden', error: 'You no longer manage live streams on this channel' }, 403);
		}
		const result = await checkLiveTier(db, { userId, roles: rolesOf(c), channelOwnerId: ownerId }, op, { sessionId: stream.sessionId ?? null });
		if ('code' in result) {
			logger.info('[Live] Refused by the creator tier', { streamId: stream.id, op, code: result.code, subjectId: result.subjectId });
			// Not in the tier: live is hidden for this channel, so its API answers quietly
			if (result.code === LIVE_TIER_ERROR_CODES.notInTier) return featureOff(c, 'live');
			return c.json({ success: false, code: result.code, error: result.error, ...result.details }, result.status);
		}
		return { ownerId: result.subjectId, limitMinutes: result.limitMinutes };
	} catch (error) {
		logger.error('[Live] Creator tier check failed; refusing', { streamId: stream.id, op, error: error instanceof Error ? error.message : String(error) });
		return c.json({ success: false, code: 'creator_access_unavailable', error: 'This is briefly unavailable; try again shortly', retryAfter: 30 }, 503, { 'Retry-After': '30' });
	}
}

function providerFailure(c: AppContext, error: unknown, where: string) {
	if (error instanceof LiveRefusedError) {
		// No provider may take streams (off, unconfigured or over budget): live is hidden
		if (error.code !== 'live_capacity') return featureOff(c, 'live');
		return fail(c, 503, error.code, 'Live streaming is at capacity right now. Try again in a few minutes.');
	}
	if (error instanceof LiveProviderError) {
		logger.error(`[Live] ${where} failed at the provider`, { provider: error.provider, code: error.code });
		return fail(c, 502, 'live_provider_error', 'The live service could not be reached. Try again.');
	}
	throw error;
}

/** Bunny recordings on a token-auth library need a signed playlist URL. */
const signVod = (c: AppContext, url: string | null) => signLiveVodUrl(c.env as never, url);

/** The session a self-hosted live URL belongs to (`https://<host>/hls/<session>/…`). */
const sessionOfUrl = (url: string) => /\/hls\/([^/]+)\//.exec(url)?.[1] ?? '';

/** What is not open to everyone plays for the stream's managers with a signed URL (lib/live/access.ts). */
export async function forManager(c: AppContext, stream: object, manages: boolean, url: string | null | undefined): Promise<string | null> {
	if (!url || !manages || liveSessionAccess(stream, sessionOfUrl(url)) !== 'managers') return url ?? null;
	// A signed URL is the caller's alone
	privateAnswer(c);
	return signManagerUrl(env(c), url);
}

/** The state the owner's endpoints answer with (ingest, start, end): its URLs play for them. */
async function managerState(c: AppContext, stream: LiveStreamRecord) {
	const state = await streamState(env(c), stream);
	return { ...state, playbackUrl: await forManager(c, stream, true, state.playbackUrl), vodUrl: await forManager(c, stream, true, state.vodUrl) };
}

export class LiveStreamGet extends OptionalAuthRoute {
	schema = {
		tags: ['Live Streams'],
		summary: 'Get a live stream',
		request: { params: Params },
		responses: { '200': Ok(z.object({ stream: z.record(z.string(), z.any()) }), 'The stream'), '404': Err('Not found') },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const stream = await visibleStream(c, params.id, userId);
		if (stream instanceof Response) return stream;
		const manages = await canManageLiveStream(c.env as never, stream, userId);
		const view = publicStream(stream, manages);
		// Its recording's URL may be signed for this request
		privateAnswer(c);
		const eventType = shownEventType(stream, await switchOn(c, 'liveEvents'));
		const reminderCount = (await reminderCounts(c, [stream.id])).get(stream.id) ?? 0;
		return { success: true, result: { stream: { ...view, eventType, reminderCount, playbackUrl: await forManager(c, stream, manages, view.playbackUrl ?? null), vodUrl: await forManager(c, stream, manages, await signVod(c, (view.vodUrl as string | null) ?? null)) } } };
	}
}

export class LiveStreamStateGet extends OptionalAuthRoute {
	schema = {
		tags: ['Live Streams'],
		summary: 'Live state of a stream',
		description: 'Polled by Studio (every 5 s) and the watch page. `qoe` tells the player whether to send QoE beacons.',
		request: { params: Params },
		responses: { '200': Ok(z.object({ pollAfterMs: PollAfterMs }).passthrough(), 'The state'), '404': Err('Not found') },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const stream = await visibleStream(c, params.id, this.getUserId(c));
		if (stream instanceof Response) return stream;
		const state = await streamState(env(c), stream);
		const manages = await canManageLiveStream(c.env as never, stream, this.getUserId(c));
		const hideRecording = recordingHidden(stream, manages);
		const settings = env(c).SEARCH_DB ? await readLiveRouting(env(c).SEARCH_DB!) : null;
		// People watching now (AlUmmahNow#30), only while live: Studio polls this every 5 s
		const live = state.status === 'live' || state.sessionStatus === 'live';
		const viewers = live ? await countLiveViewers(c.env as never, stream.id) : null;
		// Live chat (wiki E17): what this caller may do, nothing at all while it is off
		const appDb = env(c).SEARCH_DB;
		const chatOn = appDb ? (await featureGate(c.env as never, 'liveChat').catch(() => ({ on: false as const }))).on : false;
		const chat = await chatState(c, chatOn ? await readChatStream(appDb as never, stream.id).catch(() => null) : null, this.getUserId(c), chatOn);
		const remindersOn = appDb ? (await featureGate(c.env as never, 'liveReminders').catch(() => ({ on: false as const }))).on : false;
		const open = remindersOn ? await remindable(c.env as never, stream.id).catch(() => null) : null;
		const reminder = { enabled: !!open, count: open?.count ?? 0, set: open ? await hasReminder(env(c).NOTIFICATIONS_DB, stream.id, this.getUserId(c)).catch(() => false) : false };
		privateAnswer(c);
		return {
			success: true,
			// serverNow: the player's clock offset for glass-to-glass latency (QoE beacons)
			result: { ...state, playbackUrl: await forManager(c, stream, manages, state.playbackUrl), vodUrl: hideRecording ? null : await forManager(c, stream, manages, await signVod(c, state.vodUrl)), provider: stream.provider ?? null, qoe: { sampleRate: settings?.qoeSampleRate ?? 0 }, viewers, serverNow: Date.now(), ...liveAppState(stream, manages), eventType: shownEventType(stream, await switchOn(c, 'liveEvents')), ...chat, reminder },
		};
	}
}

export class LiveStreamIngestGet extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Encoder settings (owner)',
		description: '🔒 The ingest URL, stream key and a ready ffmpeg command for the stream\'s current session. Provisions a session when the stream has none.',
		request: { params: Params },
		responses: { '200': Ok(z.record(z.string(), z.any()), 'Ingest settings'), '402': Err('This month\'s live hours are used (live_hours_used)'), '403': Err('Not the owner, or live is not in the creator tier (live_not_in_tier)'), '404': Err('Not found'), '503': Err('No provider available') },
	});
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const stream = await ownedStream(c, params.id, this.getUserId(c));
		if (stream instanceof Response) return stream;
		if (streamIsRemoved(stream)) return (await liveStreamIsFrozen(c.env, stream as Record<string, unknown>)) ? fail(c, 403, CHANNEL_SUSPENDED_CODE, 'This channel is suspended on Al Ummah Now videos') : apiError(c, 403, 'live_stream_removed');
		if (isPremiere(stream)) return apiError(c, 409, 'premiere_no_ingest');
		// An ended stream only shows its last settings; anything that may provision a session is gated
		let tier: SessionTier = {};
		if (stream.status !== 'ended' && stream.status !== 'cancelled') {
			const gate = await liveTierGate(c, stream, 'ingest', this.getUserId(c));
			if (gate instanceof Response) return gate;
			tier = gate;
		}
		try {
			const out = await streamIngest(env(c), stream, tier);
			privateAnswer(c);
			return { success: true, result: { ingest: out.ingest, state: await managerState(c, out.stream) } };
		} catch (error) {
			return providerFailure(c, error, 'Ingest');
		}
	}
}

export class LiveStreamStart extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Go live (owner)',
		description: '🔒 Opens ingest for the stream. The stream shows as live when the encoder\'s first video arrives.',
		request: { params: Params },
		responses: { '200': Ok(z.record(z.string(), z.any()), 'Started'), '409': Err('The channel is being moved to another account (transfer_in_progress)'), '402': Err('This month\'s live hours are used (live_hours_used)'), '403': Err('Not the owner, suspended, live not in the creator tier (live_not_in_tier) or at the tier\'s streams-at-once limit (live_concurrent_limit)'), '404': Err('Not found'), '503': Err('No provider available') },
	});
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const stream = await ownedStream(c, params.id, this.getUserId(c));
		if (stream instanceof Response) return stream;
		if (await liveStreamIsFrozen(c.env, stream as Record<string, unknown>)) return fail(c, 403, CHANNEL_SUSPENDED_CODE, 'This channel is suspended on Al Ummah Now videos');
		if (streamIsRemoved(stream)) return apiError(c, 403, 'live_stream_removed');
		// The route serves both kinds, so the switch is checked here (feature-routes.ts 'handler'). Unreadable: refused
		const key = isPremiere(stream) ? 'livePremieres' : 'live';
		if (!(await switchOn(c, key))) return featureOff(c, key);
		// A channel being moved to another owner can't go live until the move finishes (wiki AUN-CHANNEL-CLAIM §3.3)
		if (stream.channelId && (await openTransferJob(c.env as never, stream.channelId))) return fail(c, 409, 'transfer_in_progress', 'This channel is being moved to another account. Try again shortly.');
		if (isPremiere(stream)) {
			const outcome = await startPremiere(c.env as never, stream.id, { early: true });
			if (outcome !== 'started') return outcome === 'waiting' ? apiError(c, 409, 'premiere_not_startable') : apiError(c, 409, outcome === 'cancelled' ? 'premiere_video_not_ready' : 'premiere_started');
			return { success: true, result: { ingest: null, state: liveAppState((await readStream(env(c), stream.id)) ?? stream, true) } };
		}
		const tier = await liveTierGate(c, stream, 'start', this.getUserId(c));
		if (tier instanceof Response) return tier;
		try {
			const out = await streamStart(env(c), stream, Date.now(), tier);
			return { success: true, result: { ingest: out.ingest, state: await managerState(c, out.stream) } };
		} catch (error) {
			return providerFailure(c, error, 'Start');
		}
	}
}

export class LiveStreamEnd extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'End the stream (owner)',
		description: '🔒 Stops ingest and publishes the recording.',
		request: { params: Params },
		responses: { '200': Ok(z.record(z.string(), z.any()), 'Ended'), '403': Err('Not the owner'), '404': Err('Not found') },
	});
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const stream = await ownedStream(c, params.id, this.getUserId(c));
		if (stream instanceof Response) return stream;
		if (isPremiere(stream)) {
			if (stream.status === 'scheduled') return apiError(c, 409, 'premiere_fixed');
			return { success: true, result: { state: liveAppState((await endPremiere(c.env as never, stream.id)) ?? stream, true) } };
		}
		const out = await streamEnd(env(c), stream, 'owner');
		return { success: true, result: { state: await managerState(c, out.stream) } };
	}
}

export class LiveStreamDelete extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Delete a live stream (owner)',
		description: '🔒 Ends the stream\'s session when one is still open (provisioned or live), then removes the stream. Analytics rows stay for the provider comparison.',
		request: { params: Params },
		responses: { '200': Ok(z.object({ deleted: z.boolean() }), 'Deleted'), '403': Err('Not the owner'), '404': Err('Not found') },
	});
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const stream = await ownedStream(c, params.id, this.getUserId(c));
		if (stream instanceof Response) return stream;
		// A scheduled premiere is cancelled first, so its video is free; a running one is ended first by its owner
		if (isPremiere(stream) && (stream.status === 'scheduled' || stream.status === 'live') && (await cancelPremiere(c.env as never, stream.id, 'owner')).outcome === 'started') return apiError(c, 409, 'premiere_started');
		await deleteStream(env(c), stream);
		return { success: true, result: { deleted: true } };
	}
}

export class LiveStreamViewers extends PublicRoute {
	schema = {
		tags: ['Live Streams'],
		summary: 'Watching heartbeat',
		description:
			'The watch page sends this every 20 s while it plays a live stream, with a random id kept for the tab (no user data), and `leaving: true` when the tab closes. Answers how many people are watching now (`viewers`, null when the count is briefly unavailable). The body is JSON; it may be sent as text/plain (navigator.sendBeacon, no CORS preflight).',
		request: { params: Params },
		responses: {
			'200': Ok(z.object({ viewers: z.number().int().nullable() }), 'Counted'),
			'400': Err('Rejected'),
			'404': Err('Not found'),
			'409': Err('The stream is not live'),
		},
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const raw = await c.req.text().catch(() => '');
		let body: { viewerId?: unknown; leaving?: unknown } = {};
		try {
			body = raw.length <= 1024 ? (JSON.parse(raw) as typeof body) : {};
		} catch {
			body = {};
		}
		if (!isViewerId(body?.viewerId)) return fail(c, 400, 'rejected', 'viewerId required');
		const stream = await visibleStream(c, params.id, undefined);
		if (stream instanceof Response) return stream;
		const leaving = body.leaving === true;
		// Only a stream that can be live is counted (bounds the objects anyone can create); a leaving tab always is
		if (!leaving && (stream.status === 'ended' || stream.status === 'cancelled')) return fail(c, 409, 'not_live', 'The stream is not live');
		privateAnswer(c);
		return { success: true, result: { viewers: await beatLiveViewer(c.env as never, stream.id, body.viewerId, leaving, await viewerNet(c.req.header('CF-Connecting-IP'), stream.id)) } };
	}
}

export class LiveStreamQoe extends PublicRoute {
	schema = {
		tags: ['Live Streams'],
		summary: 'Player QoE beacon',
		description: 'Sampled player statistics for the provider comparison (no user data). 204 when stored. The body is JSON; it may be sent as text/plain (navigator.sendBeacon, no CORS preflight).',
		request: { params: Params },
		responses: { '204': { description: 'Stored' }, '400': Err('Rejected') },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const db = env(c).SEARCH_DB;
		if (!db) return new Response(null, { status: 204 });
		try {
			const raw = await c.req.text().catch(() => '');
			if (raw.length > 16_384) throw new QoeRejected('too large');
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new QoeRejected('invalid json');
			}
			const beacon = parseBeacon(parsed);
			if (beacon.streamId !== params.id) throw new QoeRejected('stream mismatch');
			const colo = (c.req.raw as { cf?: { colo?: string } }).cf?.colo ?? null;
			await recordBeacon(db, beacon, { colo, isTest: c.req.header('x-live-test') === '1' });
			return new Response(null, { status: 204 });
		} catch (error) {
			if (error instanceof QoeRejected) return fail(c, 400, 'rejected', error.message);
			throw error;
		}
	}
}
