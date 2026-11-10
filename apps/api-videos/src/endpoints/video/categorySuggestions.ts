import { Str } from "chanfana";
import { z } from "zod";
import {
	CATEGORY_TEXT_LIMITS,
	buildCategoryText,
	categoryInputHash,
	draftSubjectId,
	findCategorySuggestionByHash,
	getCategorySuggestion,
	markCategorySuggestionPending,
	parseOptions,
	recordCategorySuggestionResult,
	toSuggestionView,
	type CategorySuggestionRow,
	type VideoObject,
} from "@al-ummah/shared-types";
import { AuthenticatedRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { searchDbOf, sendCategorySuggest } from "../../lib/categorySuggestions";

const ScoreSchema = z.object({ category: z.string(), confidence: z.number() });
const SuggestionSchema = z.object({
	status: z.enum(["pending", "done", "failed", "budget", "disabled", "empty"]).describe("pending: poll again; done: see preselect/options; anything else: no suggestion (pick by hand)"),
	preselect: z.string().nullable().describe("Category to preselect (confidence at or above the threshold), else null"),
	lowConfidence: z.boolean().describe("True when nothing is preselected: offer `options` instead"),
	category: z.string().nullable(),
	confidence: z.number().nullable(),
	options: z.array(ScoreSchema).describe("Top options, best first (up to 3)"),
	model: z.string().nullable(),
	outcome: z.enum(["pending", "accepted", "changed", "none"]),
	categorySource: z.enum(["uploader", "ai", "admin"]).nullable().optional().describe("Video requests: who set the video's current category"),
});
const Envelope = z.object({ success: z.boolean(), result: SuggestionSchema });
const ErrorSchema = z.object({ success: z.boolean(), error: z.string() });

const DRAFT_KEY = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
// Only Arabic and English are read (CATEGORY_LANGUAGES); anything else is refused, not silently sent on
const localized = (max: number) => z.object({ ar: z.string().max(max).optional(), en: z.string().max(max).optional() }).strict();

function present(row: CategorySuggestionRow, extra: Record<string, unknown> = {}) {
	const view = toSuggestionView(row);
	return {
		status: view.status,
		preselect: view.preselect,
		lowConfidence: view.lowConfidence,
		category: view.category,
		confidence: view.confidence,
		options: view.options,
		model: view.model,
		outcome: view.outcome,
		...extra,
	};
}

const EMPTY = { status: "empty" as const, preselect: null, lowConfidence: false, category: null, confidence: null, options: [], model: null, outcome: "none" as const };

/**
 * POST /api/videos/category-suggestions
 * Ask for an AI category suggestion for the text in the upload or edit form.
 * Answers at once when the same text was classified before; otherwise queues
 * the job and answers 202 `pending` (poll GET with the same draftKey).
 */
export class CategorySuggestionRequest extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Request an AI category suggestion for form text",
		description:
			"🔒 Authenticated. The form's title, description and tags (Arabic and/or English) are classified by AI in a queued job. `draftKey` identifies the form (one per upload or edit form). Answers `done` immediately when this text was classified before, else 202 `pending`. Never blocks an upload: the form works without a suggestion.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							draftKey: DRAFT_KEY.describe("Client-generated key of the form (8-80 chars, A-Z a-z 0-9 _ -)"),
							title: z.string().max(500).optional(),
							titleLocalized: localized(500).optional(),
							description: z.string().max(10000).optional(),
							descriptionLocalized: localized(10000).optional(),
							tags: z.array(z.string().max(100)).max(50).optional(),
						}),
					},
				},
			},
		},
		responses: {
			"200": { description: "Suggestion (done or empty)", content: { "application/json": { schema: Envelope } } },
			"202": { description: "Queued: poll GET /api/videos/category-suggestions?draftKey=…", content: { "application/json": { schema: Envelope } } },
			"503": { description: "Search database not configured", content: { "application/json": { schema: ErrorSchema } } },
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const db = searchDbOf(c.env);
		if (!db) return c.json({ success: false, error: "search_unavailable" }, 503);

		// The job rebuilds the text from exactly this input, so its hash matches ours
		const input = {
			title: body.title,
			titleLocalized: body.titleLocalized,
			description: body.description,
			descriptionLocalized: body.descriptionLocalized,
			tags: (body.tags ?? []).slice(0, CATEGORY_TEXT_LIMITS.tags),
		};
		const text = buildCategoryText(input);
		if (!text) return c.json({ success: true, result: EMPTY });

		const subjectId = draftSubjectId(userId, body.draftKey);
		const inputHash = await categoryInputHash(text);
		const existing = await getCategorySuggestion(db, subjectId);
		if (existing && existing.input_hash === inputHash && (existing.status === "done" || existing.status === "pending")) {
			return c.json({ success: true, result: present(existing) }, existing.status === "pending" ? 202 : 200);
		}

		await markCategorySuggestionPending(db, { subjectId, subjectType: "draft", reason: "draft", userId, channelId: c.req.header("channelId") ?? null });
		const cached = await findCategorySuggestionByHash(db, inputHash);
		if (cached) {
			await recordCategorySuggestionResult(db, subjectId, { status: "done", inputHash, scores: parseOptions(cached.options_json), model: cached.model, threshold: cached.threshold ?? undefined });
			const row = await getCategorySuggestion(db, subjectId);
			logger.info("[CategorySuggest] Draft answered from an earlier identical text", { userId, category: row?.category });
			return c.json({ success: true, result: present(row!) });
		}

		await recordCategorySuggestionResult(db, subjectId, { status: "pending", inputHash });
		try {
			await sendCategorySuggest(c.env, {
				subjectId,
				subjectType: "draft",
				reason: "draft",
				requestedBy: userId,
				text: input,
			});
		} catch (error) {
			// The form works without a suggestion: report failed so it stops polling
			logger.warn("[CategorySuggest] Draft enqueue failed", { userId, error: error instanceof Error ? error.message : String(error) });
			await recordCategorySuggestionResult(db, subjectId, { status: "failed", inputHash, error: "enqueue_failed" });
		}
		const row = await getCategorySuggestion(db, subjectId);
		return c.json({ success: true, result: present(row!) }, row?.status === "pending" ? 202 : 200);
	}
}

/**
 * GET /api/videos/category-suggestions?draftKey=… | ?videoId=…
 */
export class CategorySuggestionGet extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get the AI category suggestion of a form or of one of your videos",
		description: "🔒 Authenticated. `draftKey`: the suggestion requested by your form. `videoId`: the suggestion for your video (owner only), with who set its current category.",
		request: {
			query: z.object({
				draftKey: DRAFT_KEY.optional(),
				videoId: Str({ required: false }),
			}),
		},
		responses: {
			"200": { description: "Suggestion", content: { "application/json": { schema: Envelope } } },
			"400": { description: "Neither draftKey nor videoId", content: { "application/json": { schema: ErrorSchema } } },
			"404": { description: "No suggestion (or not your video)", content: { "application/json": { schema: ErrorSchema } } },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const db = searchDbOf(c.env);
		if (!db) return c.json({ success: false, error: "search_unavailable" }, 503);

		if (query.draftKey) {
			const row = await getCategorySuggestion(db, draftSubjectId(userId, query.draftKey));
			if (!row) return c.json({ success: false, error: "not_found" }, 404);
			return c.json({ success: true, result: present(row) });
		}
		if (query.videoId) {
			const video = await new R2Repository<VideoObject>(c.env.videos).getObject(query.videoId);
			if (!video || video.userId !== userId) return c.json({ success: false, error: "not_found" }, 404);
			const row = await getCategorySuggestion(db, query.videoId);
			if (!row) return c.json({ success: false, error: "not_found" }, 404);
			const categorySource = video.category ? (video.categorySource ?? "uploader") : null;
			return c.json({ success: true, result: present(row, { categorySource }) });
		}
		return c.json({ success: false, error: "draftKey or videoId is required" }, 400);
	}
}
