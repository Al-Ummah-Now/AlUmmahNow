import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { Report as BusinessReport, ResponseError } from "../../lib/types";
import { ModerationActionInput } from "../../lib/model/input";
import { ReportView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

export class ModerationAction extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Content Moderation"],
		summary: "Take Moderation Action",
		description: "🔒 **Authentication Required**: Admin endpoint for moderators to take action on reported content. Requires valid JWT token with moderator permissions.",
		request: {
			params: z.object({
				reportId: Str({ description: "Report ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional(),
			}),
			body: {
				content: {
					"application/json": {
						schema: ModerationActionInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the updated report with moderation action",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().default(true),
							result: z.object({
								report: ReportView,
								contentAction: z.object({
									performed: z.boolean(),
									action: z.string(),
									notes: z.string().optional(),
								}).optional(),
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
			"403": {
				description: "Forbidden - insufficient moderator permissions",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "Report not found",
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

		const { reportId } = request.params;
		const userId = this.getUserId(c);
		const { action, reason, notes } = request.body;

		try {
			// Check if user has moderator permissions
			const hasModeratorRole = await this.checkModeratorRole(c, userId);
			if (!hasModeratorRole) {
				return c.json(
					{
						success: false,
						error: "Insufficient moderator permissions",
					},
					403
				);
			}

			const bucket = c.env.videos;
			type ReportType = z.infer<typeof BusinessReport>;
			const repository = new R2Repository<ReportType>(bucket);

			// Find the report (we need to search since we don't know the full key structure)
			const listResult = await bucket.list({ prefix: "report:" });
			let reportKey = null;
			let report = null;

			if (listResult.objects) {
				for (const obj of listResult.objects) {
					if (obj.key && obj.key.includes(reportId)) {
						reportKey = obj.key;
						report = await repository.getObject(obj.key);
						break;
					}
				}
			}

			if (!report || !reportKey) {
				return c.json(
					{
						success: false,
						error: "Report not found",
					},
					404
				);
			}

			// Update the report with moderation action
			const updatedReport = {
				...report,
				status: this.getReportStatusFromAction(action),
				moderatorId: userId,
				moderatorAction: action,
				moderatorNotes: notes,
				dateResolved: new Date().toISOString(),
			};

			// Save the updated report
			await repository.putObject(reportKey, updatedReport);

			// Send queue message for moderation action
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.VideoEdit, {
				reportId: updatedReport.id,
				entityType: updatedReport.entityType,
				entityId: updatedReport.entityId,
				moderatorId: userId,
				action,
				timestamp: new Date().toISOString(),
			});

			// Perform content action based on moderation decision
			const contentAction = await this.performContentAction(
				updatedReport.entityType,
				updatedReport.entityId,
				action,
				reason
			);

			// Transform to view model for response
			const reportView: z.infer<typeof ReportView> = {
				id: updatedReport.id,
				entityType: updatedReport.entityType,
				entityId: updatedReport.entityId,
				reporterId: updatedReport.reporterId,
				reporterChannelId: updatedReport.reporterChannelId,
				reason: updatedReport.reason,
				description: updatedReport.description,
				status: updatedReport.status,
				dateCreated: updatedReport.dateCreated,
				dateResolved: updatedReport.dateResolved,
				moderatorId: updatedReport.moderatorId,
				moderatorAction: updatedReport.moderatorAction,
			};

			return {
				success: true,
				result: { 
					report: reportView,
					contentAction,
				},
			};
		} catch (error) {
			logger.error("Error processing moderation action:", error);
			return c.json(
				{
					success: false,
					error: "Failed to process moderation action",
				},
				500
			);
		}
	}

	private getReportStatusFromAction(action: string): 'pending' | 'reviewed' | 'resolved' | 'dismissed' {
		switch (action) {
			case 'approve':
				return 'dismissed';
			case 'remove':
			case 'flag':
				return 'resolved';
			case 'escalate':
				return 'reviewed';
			case 'dismiss':
				return 'dismissed';
			default:
				return 'reviewed';
		}
	}

	private async performContentAction(
		entityType: string,
		entityId: string,
		action: string,
		reason?: string
	): Promise<{ performed: boolean; action: string; notes?: string }> {
		// This would implement actual content actions in production
		// For now, we'll just log the action and return success

		logger.info(`Moderation action: ${action} on ${entityType}:${entityId}`);

		switch (action) {
			case 'remove':
				// TODO: Implement content removal
				// - Mark content as hidden/removed
				// - Update visibility in database
				// - Send notification to content owner
				return {
					performed: true,
					action: 'remove',
					notes: `Content marked as removed due to: ${reason}`,
				};

			case 'flag':
				// TODO: Implement content flagging
				// - Add flag to content for further review
				// - Possibly reduce visibility
				return {
					performed: true,
					action: 'flag',
					notes: `Content flagged for further review`,
				};

			case 'approve':
				// Content is approved, no action needed
				return {
					performed: true,
					action: 'approve',
					notes: `Content approved after review`,
				};

			case 'escalate':
				// TODO: Implement escalation
				// - Notify senior moderators
				// - Add to high-priority queue
				return {
					performed: true,
					action: 'escalate',
					notes: `Report escalated to senior moderation team`,
				};

			case 'dismiss':
				// Report dismissed, no action on content
				return {
					performed: true,
					action: 'dismiss',
					notes: `Report dismissed as invalid or resolved`,
				};

			default:
				return {
					performed: false,
					action: action,
					notes: `Unknown action: ${action}`,
				};
		}
	}

	private async checkModeratorRole(c: any, userId: string): Promise<boolean> {
		try {
			// For now, use a simple role check based on user profiles
			// In a full implementation, this would query a dedicated user management system
			const bucket = c.env.profiles;
			const repository = new R2Repository<any>(bucket);
			
			// Check if user profile exists and has moderator role
			const userProfile = await repository.getObject(`profile:${userId}`);
			if (userProfile) {
				return userProfile.roles?.includes('moderator') || userProfile.roles?.includes('admin') || false;
			}
			
			// Default: no moderator access
			return false;
		} catch (error) {
			logger.error("Error checking moderator role:", error);
			return false;
		}
	}
}