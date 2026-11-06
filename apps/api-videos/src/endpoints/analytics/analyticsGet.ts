import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { ResponseError } from "../../lib/types";
import { AnalyticsQueryInput } from "../../lib/model/input";
import { AnalyticsSummaryView } from "../../lib/model/view";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from '../../lib/logger';
import {
	AnalyticsChannel,
	AnalyticsVideo,
	DailyMetric,
	DateRange,
	MonthlyRollup,
	buildDailySeries,
	engagementRate,
	loadOwnedChannels,
	loadOwnedVideos,
	loadRollups,
	parseRange,
	previousRange,
	rankTopVideos,
	sumSeries,
} from "../../lib/analytics";

export class AnalyticsGet extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Analytics"],
		summary: "Get Analytics Data",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token. Owner-scoped analytics for one of your videos (`entityType=video&entityId=`), one of your channels (`entityType=channel&entityId=`), or all of your channels (no `entityId`). Views and watch time come from processor rollups, likes/comments/subscribers from stored records; `previous` is the equally long period before the range.",
		request: {
			query: AnalyticsQueryInput,
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional(),
			}),
		},
		responses: {
			"200": {
				description: "Returns analytics data",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().default(true),
							result: z.object({
								analytics: AnalyticsSummaryView,
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid query parameters",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"403": {
				description: "Forbidden - insufficient permissions to access analytics",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	});

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { 
			entityType = 'video', 
			entityId, 
			startDate, 
			endDate, 
			metrics = ['views', 'likes', 'comments'], 
			granularity = 'day' 
		} = request.query;
		const userId = this.getUserId(c);

		try {
			const { from: startDateTime, to: endDateTime } = parseRange(startDate, endDate);

			const analyticsData = await this.getAnalyticsData(
				c,
				entityType,
				entityId,
				userId,
				startDateTime,
				endDateTime,
				metrics,
				granularity
			);

			if (analyticsData.status !== 200) {
				return c.json({ success: false, error: analyticsData.error }, analyticsData.status);
			}

			return {
				success: true,
				result: {
					analytics: analyticsData.analytics,
				},
			};
		} catch (error) {
			logger.error("Error fetching analytics:", error);
			return c.json(
				{
					success: false,
					error: "Failed to fetch analytics data",
				},
				500
			);
		}
	}

	/**
	 * Real, owner-scoped analytics for a video, a channel, or (no entityId) all of
	 * the caller's channels. Current vs previous values compare the requested range
	 * with the equally long range right before it.
	 */
	private async getAnalyticsData(
		c: AppContext,
		entityType: string,
		entityId: string | undefined,
		userId: string,
		startDate: Date,
		endDate: Date,
		metrics: string[],
		granularity: string
	) {
		const range: DateRange = { from: startDate, to: endDate };
		const previous = previousRange(range);
		const spanning: DateRange = { from: previous.from, to: range.to };

		const ownedChannels = await loadOwnedChannels(c.env.channels, userId);
		let channels: AnalyticsChannel[] = ownedChannels;
		let videos: AnalyticsVideo[];
		let rollups: MonthlyRollup[];

		if (entityType === 'video' && entityId) {
			const object = await c.env.videos.get(entityId);
			const video = object ? await object.json<AnalyticsVideo>() : null;
			if (!video || video.isDeleted) return { status: 404 as const, error: "Video not found" };
			if (video.userId !== userId) return { status: 403 as const, error: "You can only view analytics for your own videos" };
			videos = [video];
			// Subscribers belong to channels, not videos
			channels = [];
			rollups = await loadRollups(c.env.analytics_rollups, 'video', [video.id], spanning);
		} else {
			if (entityType === 'channel' && entityId) {
				const match = ownedChannels.find(ch => ch.id === entityId);
				if (!match) return { status: 403 as const, error: "You can only view analytics for channels you own" };
				channels = [match];
			}
			videos = channels.length
				? await loadOwnedVideos(c.env.videos, userId, new Set(channels.map(ch => ch.id)))
				: [];
			rollups = await loadRollups(c.env.analytics_rollups, 'channel', channels.map(ch => ch.id), spanning);
		}

		const currentSeries = buildDailySeries(range, videos, channels, rollups);
		const previousSeries = buildDailySeries(previous, videos, channels, rollups);
		const current = sumSeries(currentSeries);
		const prior = sumSeries(previousSeries);

		const valueOf = (metric: string, totals: ReturnType<typeof sumSeries>): number => {
			switch (metric) {
				case 'views': return totals.views;
				case 'likes': return totals.likes;
				case 'comments': return totals.comments;
				case 'shares': return totals.shares;
				case 'watch_time': return totals.watchTime;
				case 'engagement_rate': return engagementRate(totals.views, totals.likes, totals.comments);
				default: return 0;
			}
		};

		const metricsData: Record<string, { current: number; previous: number; change: number; changePercent: number }> = {};
		for (const metric of metrics) {
			const now = valueOf(metric, current);
			const before = valueOf(metric, prior);
			metricsData[metric] = {
				current: now,
				previous: before,
				change: Math.round((now - before) * 10) / 10,
				changePercent: before > 0 ? Math.round(((now - before) / before) * 100) : 0,
			};
		}

		const chartData = groupSeries(currentSeries, granularity).map(point => ({
			date: point.date,
			values: Object.fromEntries(metrics.map(metric => [metric, valueOf(metric, point)])),
		}));

		const topPerformingContent = rankTopVideos(videos, 5).map(video => ({
			id: video.videoId,
			title: video.title,
			metric: 'views',
			value: video.views,
		}));

		return {
			status: 200 as const,
			analytics: {
				entityType,
				entityId: entityId || 'all',
				period: {
					startDate: startDate.toISOString(),
					endDate: endDate.toISOString(),
				},
				metrics: metricsData,
				topPerformingContent,
				chartData,
			},
		};
	}
}

/**
 * Group a daily series by week (ISO week starting Monday) or month. Hourly data is
 * not recorded, so 'hour' falls back to daily points.
 */
function groupSeries(series: DailyMetric[], granularity: string): DailyMetric[] {
	if (granularity !== 'week' && granularity !== 'month') return series;
	const groups = new Map<string, DailyMetric>();
	for (const day of series) {
		const date = new Date(`${day.date}T00:00:00.000Z`);
		let key: string;
		if (granularity === 'month') {
			key = `${day.date.slice(0, 7)}-01`;
		} else {
			const offset = (date.getUTCDay() + 6) % 7;
			key = new Date(date.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		}
		const entry = groups.get(key) || { date: key, views: 0, likes: 0, comments: 0, shares: 0, subscribers: 0, watchTime: 0 };
		entry.views += day.views;
		entry.likes += day.likes;
		entry.comments += day.comments;
		entry.shares += day.shares;
		entry.subscribers += day.subscribers;
		entry.watchTime += day.watchTime;
		groups.set(key, entry);
	}
	return [...groups.values()];
}
