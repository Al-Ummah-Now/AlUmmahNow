import { Str } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import { recordQoe, QOE_DEVICES } from "../../lib/media/qoe";

/**
 * POST /api/videos/:id/qoe
 * One play session's measurements, tagged by delivery source (Bunny or R2,
 * epic #687): startup, rebuffering, bitrate, switches, errors and fallback.
 * Summed per day, source, device class and country in D1 (one upsert per
 * session). Shares the WATCH_TIME_LIMITER binding under its own key.
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
				const { success } = await c.env.WATCH_TIME_LIMITER.limit({ key: `qoe:${body.sessionId}:${id}` });
				if (!success) return c.json({ success: false, error: "Too many reports" }, 429);
			} catch (error) {
				logger.warn("[qoe] rate limiter unavailable", { error });
			}
		}
		const country = body.country ?? ((c.req.raw as { cf?: { country?: string } }).cf?.country ?? "XX").slice(0, 2).toUpperCase();
		const write = recordQoe(c.env as never, {
			...(body as Required<Pick<typeof body, 'source' | 'device' | 'started'>> & typeof body),
			rebuffers: body.rebuffers ?? 0,
			rebufferMs: body.rebufferMs ?? 0,
			watchMs: body.watchMs ?? 0,
			switches: body.switches ?? 0,
			errors: body.errors ?? 0,
			fallback: body.fallback ?? false,
			country,
			day: new Date().toISOString().slice(0, 10),
		});
		try {
			c.executionCtx.waitUntil(write);
		} catch {
			await write;
		}
		return c.json({ success: true }, 202);
	}
}
