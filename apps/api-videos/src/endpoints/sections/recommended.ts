import { OptionalAuthRoute, AppContext } from "../../base";
import { Num, Str, Bool } from "../../lib/chanfana-params";
import { z } from "zod";
import { emptyShelf } from "../../lib/shelf";
import { rankRecommendations } from "../../lib/discovery";
import { hydrateRanked, loadCandidatePool } from "../../lib/recommendations";
import { withChannelNames } from "../../lib/channelNames";
import { FeedVideoFields, RailInfoSchema, feedItem, railItems, readRail } from "../../lib/ranking/sectionResponse";
import { decodeRailCursor, encodeRailCursor, railIds, railLabelFields, railScope } from "../../lib/ranking/serve";
import { personalOrder } from "../../lib/ranking/personal";
import { RAIL_LIMIT } from "../../lib/ranking/job";

const VideoResponseSchema = z.object({
  ...FeedVideoFields,
  recommendationScore: z.number().optional(),
});

const RecommendedVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(VideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    strategy: z.enum(['popular', 'category-based', 'random']),
    basedOn: z.string().optional(),
    lastUpdated: z.string(),
    personal: z.boolean().optional().describe("True when ordered for this viewer (subscriptions and watch history; never while history is paused)"),
    rail: RailInfoSchema.optional(),
  }),
});

export class RecommendedVideosSection extends OptionalAuthRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Recommended Videos",
    description: "Recommended videos (wiki E07 Discovery ranking). Signed in with watch history on: ordered for the viewer from their subscriptions and recent history, without videos already watched. Otherwise (signed out, or history paused): the site's top list. With seedVideoId: videos like that one.",
    request: {
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        strategy: z.enum(['popular', 'category-based', 'random']).optional().default('popular').describe("Accepted for older clients; the order is the discovery ranking"),
        language: z.enum(['ar', 'en']).optional().describe("Viewer's language: its videos rank higher (others stay)"),
        excludeWatched: Bool({
          description: "Accepted for older clients: a personal list always leaves watched videos out",
          default: false,
        }).optional(),
        seedVideoId: Str({
          description: "Base recommendations on this video",
        }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Returns recommended videos",
        content: {
          "application/json": {
            schema: RecommendedVideosResponseSchema,
          },
        },
      },
      "400": {
        description: "Bad request - invalid parameters",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    // Validation stays outside the try: invalid input is a 400 from chanfana
    const data = await this.getValidatedData<typeof this.schema>();
    try {
      const { limit: requested, cursor, strategy = 'popular', seedVideoId, language } = data.query;
      const limit = Math.min(50, Math.max(1, Math.trunc(requested) || 12));
      const userId = this.getUserId(c);
      const scope = railScope({ language });
      const now = Date.now();

      // Like one video: the related-videos ranking over the index (lib/recommendations.ts)
      if (seedVideoId) {
        const pool = await loadCandidatePool(c.env as never, seedVideoId, []);
        const offset = decodeRailCursor(cursor);
        const ranked = rankRecommendations(pool.candidates, { seeds: pool.seeds, exclude: new Set([seedVideoId]), limit: offset + limit + 5, now });
        const page = await hydrateRanked(c.env.videos, ranked.slice(offset), limit);
        const named = await withChannelNames(c.env.channels, page.map((p) => p.video));
        return c.json({
          success: true,
          data: page.map((p, i) => ({ ...feedItem(named[i] as never), recommendationScore: p.score })),
          cursor: offset + limit < ranked.length && page.length === limit ? encodeRailCursor(offset + limit) : undefined,
          metadata: { strategy, basedOn: `Video: ${seedVideoId}`, lastUpdated: new Date(now).toISOString(), personal: false },
        });
      }

      // Signed in with history on: ordered for the viewer (never while their history is paused)
      if (userId) {
        const topIds = await railIds(c.env as never, 'top', scope, RAIL_LIMIT);
        const order = await personalOrder(c.env as never, userId, topIds ?? [], now);
        if (order) {
          const offset = decodeRailCursor(cursor);
          const slice = order.slice(offset, offset + limit + 5);
          const page = await hydrateRanked(c.env.videos, slice.map((o) => ({ video: { id: o.id } as never, score: o.score })), limit);
          const named = await withChannelNames(c.env.channels, page.map((p) => p.video));
          const end = offset + limit;
          return c.json({
            success: true,
            data: page.map((p, i) => ({ ...feedItem(named[i] as never), recommendationScore: p.score })),
            cursor: end < order.length && page.length === limit ? encodeRailCursor(end) : undefined,
            metadata: { strategy, basedOn: 'Your subscriptions and watch history', lastUpdated: new Date(now).toISOString(), personal: true },
          });
        }
      }

      // Everyone else: the site's top list (quality, freshness, admin picks, viewer signal as it builds)
      const ranked = await readRail(c, { rail: 'top', scope, limit, cursor });
      if (ranked) {
        return c.json({
          success: true,
          data: railItems(ranked, (entry) => ({ recommendationScore: entry.score })),
          cursor: ranked.nextCursor,
          metadata: { strategy, basedOn: 'Top on Al Ummah Now', lastUpdated: ranked.meta.computedAt, personal: false, rail: railLabelFields(ranked.meta) },
        });
      }
      // Before the first ranking run: newest videos from the index
      const pool = await loadCandidatePool(c.env as never, undefined, []);
      const fallback = rankRecommendations(pool.candidates, { seeds: [], exclude: new Set(), limit: limit + 5, now });
      const page = await hydrateRanked(c.env.videos, fallback, limit);
      const named = await withChannelNames(c.env.channels, page.map((p) => p.video));
      return c.json({
        success: true,
        data: page.map((p, i) => ({ ...feedItem(named[i] as never), recommendationScore: p.score })),
        cursor: undefined,
        metadata: { strategy, basedOn: 'Recent videos', lastUpdated: new Date(now).toISOString(), personal: false },
      });
    } catch (error) {
      return emptyShelf(c, "recommended", error);
    }
  }
}
