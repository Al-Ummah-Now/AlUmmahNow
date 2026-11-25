import { AuthenticatedRoute, AppContext } from "../../base";
import { Bool, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { Report as BusinessReport, ResponseError } from "../../lib/types";
import { ReportInput } from "../../lib/model/input";
import { ReportView } from "../../lib/model/view";
import R2Repository, { CREATE_ONLY } from "../../lib/r2Repo";
import { reportClaimKey } from "../../lib/report-claims";
import Queue, { MessageType } from "../../lib/queue";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { featureOff } from '../../lib/features/off';
import { reportableChatMessage } from '../../lib/live/reportable';
import { isInternalVideoKey } from '@al-ummah/shared-types';

export class ReportCreate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Content Moderation"],
		summary: "Report Content",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token. Report inappropriate content, spam, harassment, or other violations.",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: ReportInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created report",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								report: ReportView,
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
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
			"404": {
				description: "A video that is not there, or a live chat message that is not there for this person, or live chat is off (feature_off)",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"409": {
				description: "Conflict - duplicate report for the same entity",
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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { channelId } = request.headers;
		const userId = this.getUserId(c);
		const inputReport = request.body;

		try {
			// A chat message (wiki E17 §5.2): only one this person may read; what it said goes with the report
			const subject = inputReport.entityType === 'live_chat' ? await reportableChatMessage(c.env as never, inputReport.entityId, userId) : undefined;
			if (subject === 'off') return featureOff(c, 'liveChat');
			if (subject === null) return apiError(c, 404, 'not_found');
			// A key of the videos bucket that is not a video's; live streams are reported as entityType livestream, by their id
			if (inputReport.entityType === 'video' && isInternalVideoKey(inputReport.entityId)) return apiError(c, 404, 'not_found');

			// Check if user has already reported this entity (prevent spam)
			const bucket = c.env.reports; // Use dedicated reports bucket for reports storage
			type ReportType = z.infer<typeof BusinessReport>;
			const repository = new R2Repository<ReportType>(bucket);

			// Someone who reported it for another reason may still raise it to child safety, once
			const raising = inputReport.reason === 'child_safety';

			// List existing reports to check for duplicates
			// Since R2Repository doesn't support prefix directly, we'll use the R2 bucket directly
			const existingReportsResponse = await bucket.list({
				prefix: `report:${inputReport.entityId}:`,
			});

			// Check if this user already reported this entity
			if (existingReportsResponse.objects) {
				for (const reportKey of existingReportsResponse.objects) {
					// Keys are report:<entityId>:<reportId>:<userId> (the old `:<userId>:` test never matched)
					if (!raising && reportKey.key && reportKey.key.endsWith(`:${userId}`)) {
						return c.json(
							{
								success: false,
								error: "You have already reported this content",
							},
							409
						);
					}
				}
			}

			// Create the business report object
			const report = {
				...inputReport,
				id: crypto.randomUUID(),
				reporterId: userId,
				reporterChannelId: channelId,
				status: 'pending' as const,
				dateCreated: new Date().toISOString(),
			};

			// One report per user and entity, claimed once (SCALABILITY-AUDIT AV-21):
			// of a double submit only the request that creates the claim files a
			// report. The report keeps its random id, so it does not reveal who filed it.
			const claimKey = reportClaimKey(report.entityId, userId);
			const previous = raising ? await bucket.get(claimKey) : null;
			const earlier = previous ? ((await previous.json().catch(() => null)) as { childSafety?: boolean } | null) : null;
			const raised = earlier?.childSafety === true;
			const claimed = raised
				? null
				: await bucket.put(claimKey, JSON.stringify({ reportId: report.id, ...(raising ? { childSafety: true } : {}) }), {
						httpMetadata: { contentType: "application/json" },
						onlyIf: previous ? { etagMatches: previous.etag } : CREATE_ONLY,
					});
			if (!claimed) {
				return c.json(
					{
						success: false,
						error: "You have already reported this content",
					},
					409
				);
			}

			// Save the report to the repository; without it the claim is released so the user can try again
			try {
				await repository.putObject(`report:${report.entityId}:${report.id}:${userId}`, report);
			} catch (error) {
				await (previous ? bucket.put(claimKey, JSON.stringify(earlier)) : bucket.delete(claimKey)).catch(() => undefined);
				throw error;
			}

			// Queue report for content moderation processing
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.ReportCreate, {
				reportId: report.id,
				entityType: report.entityType,
				entityId: report.entityId,
				reporterId: userId,
				reason: report.reason,
				// The processor persists this to D1; omitting it left every
				// report in the admin queue without the reporter's description.
				description: report.description,
				...(subject ? { subject } : {}),
				timestamp: new Date().toISOString(),
			});

			// Transform to view model for response (excluding sensitive data)
			const reportView: z.infer<typeof ReportView> = {
				id: report.id,
				entityType: report.entityType,
				entityId: report.entityId,
				reporterId: report.reporterId,
				reporterChannelId: report.reporterChannelId,
				reason: report.reason,
				description: report.description,
				status: report.status,
				dateCreated: report.dateCreated,
				dateResolved: report.dateResolved,
				moderatorId: report.moderatorId,
				moderatorAction: report.moderatorAction,
			};

			// Return the created report
			return {
				success: true,
				result: { report: reportView },
			};
		} catch (error) {
			logger.error("Error creating report:", error);
			return c.json(
				{
					success: false,
					error: "Failed to create report",
				},
				500
			);
		}
	}
}