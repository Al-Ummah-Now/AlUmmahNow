import { AuthenticatedRoute, AppContext } from "../../base";
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Report as BusinessReport, ResponseError } from "../../lib/types";
import { ReportInput } from "../../lib/model/input";
import { ReportView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from '../../lib/logger';

export class ReportCreate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Content Moderation"],
		summary: "Report Content",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token. Report inappropriate content, spam, harassment, or other violations.",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional(),
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
			// Check if user has already reported this entity (prevent spam)
			const bucket = c.env.reports; // Use dedicated reports bucket for reports storage
			type ReportType = z.infer<typeof BusinessReport>;
			const repository = new R2Repository<ReportType>(bucket);

			// List existing reports to check for duplicates
			// Since R2Repository doesn't support prefix directly, we'll use the R2 bucket directly
			const existingReportsResponse = await bucket.list({
				prefix: `report:${inputReport.entityId}:`,
			});

			// Check if this user already reported this entity
			if (existingReportsResponse.objects) {
				for (const reportKey of existingReportsResponse.objects) {
					if (reportKey.key && reportKey.key.includes(`:${userId}:`)) {
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

			// Save the report to the repository
			await repository.putObject(`report:${report.entityId}:${report.id}:${userId}`, report);

			// Queue report for content moderation processing
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.ReportCreate, {
				reportId: report.id,
				entityType: report.entityType,
				entityId: report.entityId,
				reporterId: userId,
				reason: report.reason,
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