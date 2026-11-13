import { z } from "zod";
import { PublicRoute, AppContext } from "../../base";
import { ResponseError } from "../../lib/types";
import { SITEMAP_KINDS, SITEMAP_PAGE_SIZE, sitemapPage, sitemapSummary, type SitemapKind } from "../../lib/sitemap";
import { logger } from "../../lib/logger";

/** Sitemaps change slowly; an hour at the edge keeps D1 reads to a few per hour. */
const CACHE = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

function unavailable(c: AppContext, error: unknown) {
	logger.error("[Sitemap] index unavailable", { error: error instanceof Error ? error.message : String(error) });
	c.header("Retry-After", "120");
	return c.json({ success: false, error: "sitemap_unavailable" }, 503);
}

/** GET /api/sitemap: how many pages each sitemap has (the videos site's sitemap index). */
export class SitemapSummaryGet extends PublicRoute {
	schema = {
		tags: ["Sitemap"],
		summary: "Sitemap index data",
		description: `🌐 **Public**: counts and pages (${SITEMAP_PAGE_SIZE} items each) of the public videos, channels and playlists search engines may list. Unlisted, private, scheduled and removed items are never counted.`,
		responses: {
			"200": {
				description: "Counts per kind",
				content: { "application/json": { schema: z.object({ pageSize: z.number(), kinds: z.record(z.object({ count: z.number(), pages: z.number(), lastModified: z.string().nullable() })) }) } },
			},
			"503": { description: "The search index is not available", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
		if (!db) return unavailable(c, new Error("SEARCH_DB not bound"));
		try {
			return c.json(await sitemapSummary(db as never), 200, { "Cache-Control": CACHE });
		} catch (error) {
			return unavailable(c, error);
		}
	}
}

/** GET /api/sitemap/:kind?page=N: one page of public items, oldest first. */
export class SitemapPageGet extends PublicRoute {
	schema = {
		tags: ["Sitemap"],
		summary: "One sitemap page",
		description: `🌐 **Public**: up to ${SITEMAP_PAGE_SIZE} public videos, channels or playlists (oldest first) for the videos site's sitemaps.`,
		request: {
			params: z.object({ kind: z.enum(SITEMAP_KINDS) }),
			query: z.object({ page: z.coerce.number().int().min(0).max(10_000).optional().describe("0-based page") }),
		},
		responses: {
			"200": { description: "The page", content: { "application/json": { schema: z.object({ items: z.array(z.record(z.unknown())) }) } } },
			"503": { description: "The search index is not available", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const db = (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
		if (!db) return unavailable(c, new Error("SEARCH_DB not bound"));
		try {
			const items = await sitemapPage(db as never, params.kind as SitemapKind, query.page ?? 0);
			return c.json({ items }, 200, { "Cache-Control": CACHE });
		} catch (error) {
			return unavailable(c, error);
		}
	}
}
