import { Str } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import { recordQoe, QOE_DEVICES } from "../../lib/media/qoe";
import { recordQoeLive } from "../../lib/media/qoe-live";
import { countFallback } from "../../lib/media/playback";
import { PLAYBACK_FALLBACK_REASONS } from "@al-ummah/shared-types";

/**
 * POST /api/videos/:id/qoe
 * One play session's measurements, tagged by delivery source (Bunny or R2,
 * epic #687): startup, rebuffering, bitrate, switches, errors and fallback.
 * Summed per day, source, device class and country in D1 (one upsert per
 * session). Shares the WATCH_TIME_LIMITER binding under its own key.
 *
 * Live view (Delivery page, last 60 minutes and "now"): while it plays the
 * player also sends `kind: "heartbeat"` every 30 s (and at first frame,
 * fallback and first error) with `live`, the deltas since its last report.
 * Heartbeats go only to the realtime worker's live object, never to D1; the
 * final report carries the last deltas the same way.
 */
export class VideoQoe extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Report playback quality",
		description: "🔓 **Authentication Optional**: One play session's quality measurements, tagged by delivery source.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							sessionId: z.string().min(8).max(128).describe("Playback session id (one per player load)"),
							source: z.enum(["bunny", "r2"]).describe("Source the session started on (an R2 session that fell back to Bunny stays r2, with fallback=true)"),
							country: z.string().regex(/^[A-Z]{2}$/).optional().describe("Viewer country (set by the web app's beacon route); else the request's"),
							device: z.enum(QOE_DEVICES).describe("Device class"),
							started: z.boolean().describe("Playback started"),
							startupMs: z.number().int().min(0).max(120_000).optional().describe("Play request to first frame"),
							rebuffers: z.number().int().min(0).max(10_000).default(0),
							rebufferMs: z.number().int().min(0).max(86_400_000).default(0),
							watchMs: z.number().int().min(0).max(86_400_000).default(0),
							avgKbps: z.number().min(0).max(200_000).optional().describe("Average selected bitrate, weighted by time"),
							peakKbps: z.number().min(0).max(200_000).optional(),
							switches: z.number().int().min(0).max(10_000).default(0),
							errors: z.number().int().min(0).max(1_000).default(0),
							fallback: z.boolean().default(false).describe("R2 failed and the player switched to Bunny"),
							kind: z.enum(["final", "heartbeat"]).default("final").describe("final: the session's totals (daily rollup); heartbeat: live deltas only"),
							serving: z.enum(["bunny", "r2"]).optional().describe("Source delivering the session now (bunny after a fallback)"),
							playing: z.boolean().optional().describe("Playing at the time of the report"),
							live: z
								.object({
									attempt: z.boolean().optional(),
									started: z.boolean().optional(),
									startupMs: z.number().int().min(0).max(120_000).optional(),
									watchMs: z.number().int().min(0).max(600_000).optional(),
									rebufferMs: z.number().int().min(0).max(600_000).optional(),
									rebuffers: z.number().int().min(0).max(1_000).optional(),
									avgKbps: z.number().min(0).max(200_000).optional(),
									errored: z.boolean().optional(),
									fallback: z.boolean().optional(),
								})
								.optional()
								.describe("Deltas since the session's previous report, for the live view"),
							requested: z.enum(["bunny", "r2"]).optional().describe("Source the API chose for this play"),
							actual: z.enum(["bunny", "r2"]).optional().describe("Source the session ended on (bunny after a fallback)"),
							fallbackReason: z.enum(PLAYBACK_FALLBACK_REASONS).optional().describe("Why the player left the requested source"),
						}),
					},
				},
			},
		},
		responses: {
			"202": { description: "Report accepted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
			"400": { description: "Invalid report", content: { "application/json": { schema: ResponseError } } },
			"429": { description: "Too many reports for this session", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const body = request.body;
		if (c.env.WATCH_TIME_LIMITER) {
			try {
				// Heartbeats (every 30 s, plus a few events) have their own budget, apart from the one final report
				const { success } = await c.env.WATCH_TIME_LIMITER.limit({ key: `${body.kind === "heartbeat" ? "qoe-hb" : "qoe"}:${body.sessionId}:${id}` });
				if (!success) return c.json({ success: false, error: "Too many reports" }, 429);
			} catch (error) {
				logger.warn("[qoe] rate limiter unavailable", { error });
			}
		}
		const live = body.live
			? recordQoeLive(c.env as never, {
					sessionId: body.sessionId,
					source: body.source,
					serving: body.serving ?? (body.fallback ? "bunny" : body.source),
					playing: body.kind === "heartbeat" ? (body.playing ?? false) : false,
					ended: body.kind !== "heartbeat",
					live: body.live,
				})
			: undefined;
		if (body.kind === "heartbeat") {
			if (live) {
				try {
					c.executionCtx.waitUntil(live);
				} catch {
					await live;
				}
			}
			return c.json({ success: true }, 202);
		}
		const country = body.country ?? ((c.req.raw as { cf?: { country?: string } }).cf?.country ?? "XX").slice(0, 2).toUpperCase();
		const day = new Date().toISOString().slice(0, 10);
		const requested = body.requested ?? body.source;
		const actual = body.actual ?? (body.fallback ? "bunny" : body.source);
		const fallbackWrite = requested !== actual || body.fallback
			? countFallback(c.env as never, { day, requested, actual, reason: body.fallbackReason ?? "other", column: "qoe_sessions" })
			: Promise.resolve();
		const write = Promise.all([fallbackWrite, recordQoe(c.env as never, {
			...(body as Required<Pick<typeof body, 'source' | 'device' | 'started'>> & typeof body),
			rebuffers: body.rebuffers ?? 0,
			rebufferMs: body.rebufferMs ?? 0,
			watchMs: body.watchMs ?? 0,
			switches: body.switches ?? 0,
			errors: body.errors ?? 0,
			fallback: body.fallback ?? false,
			country,
			day,
		})]);
		const work = live ? Promise.all([write, live]) : write;
		try {
			c.executionCtx.waitUntil(work);
		} catch {
			await work;
		}
		return c.json({ success: true }, 202);
	}
}
