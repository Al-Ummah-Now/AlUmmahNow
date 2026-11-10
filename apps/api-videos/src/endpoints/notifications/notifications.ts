/**
 * Notification center (Story 29.10). All routes require authentication and
 * only ever touch the caller's own rows.
 *
 * GET    /api/notifications                       list (keyset cursor) + unreadCount
 * GET    /api/notifications/unread-count          { unreadCount }
 * POST   /api/notifications/read                  { ids } mark read
 * POST   /api/notifications/read-all              mark all read
 * DELETE /api/notifications/:id                   delete one
 * GET    /api/notifications/settings              per-category settings
 * PUT    /api/notifications/settings              { settings: { category: boolean } }
 * GET    /api/notifications/channels/:channelId/bell   { bell, subscribed }
 * PUT    /api/notifications/channels/:channelId/bell   { bell: all|highlights|none }
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { isSubscribedTo } from '../../lib/subscription-store';
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { CHANNEL_BELL_LEVELS, NOTIFICATION_CATEGORIES } from "@al-ummah/shared-types";
import {
	countUnread,
	deleteNotification,
	getBell,
	getSettings,
	listNotifications,
	markAllRead,
	markRead,
	MARK_READ_MAX_IDS,
	setBell,
	updateSettings,
} from "../../lib/notifications";
import { Channel, ResponseError } from "../../lib/types";

const OptionalChannelHeader = z.object({ channelId: Str({ description: "Active channel ID" }).optional().nullable() });
const unavailable = { "503": { description: "Notifications not configured", content: { "application/json": { schema: ResponseError } } } };

function storeUnavailable(c: AppContext) {
	logger.warn("[Notifications] NOTIFICATIONS_DB not bound");
	return c.json({ success: false, error: "notifications_unavailable" }, 503);
}

export class NotificationsList extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "List my notifications (newest first)",
		request: {
			query: z.object({
				limit: z.coerce.number().int().min(1).max(50).optional().default(20),
				cursor: Str({ description: "Cursor from the previous page" }).optional(),
				unreadOnly: z.enum(["true", "false"]).optional(),
			}),
			headers: OptionalChannelHeader,
		},
		responses: { "200": { description: "Notifications page" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const [page, unreadCount] = await Promise.all([
			listNotifications(db, userId, { limit: query.limit, cursor: query.cursor, unreadOnly: query.unreadOnly === "true" }),
			countUnread(db, userId),
		]);
		return { success: true, result: { ...page, unreadCount } };
	}
}

export class NotificationsUnreadCount extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Unread notification count",
		request: { headers: OptionalChannelHeader },
		responses: { "200": { description: "{ unreadCount }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		return { success: true, result: { unreadCount: await countUnread(db, this.getUserId(c)) } };
	}
}

export class NotificationsMarkRead extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Mark notifications read",
		request: {
			body: { content: { "application/json": { schema: z.object({ ids: z.array(Str()).min(1).max(MARK_READ_MAX_IDS) }) } } },
			headers: OptionalChannelHeader,
		},
		responses: { "200": { description: "Updated count and new unread count" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const updated = await markRead(db, userId, body.ids);
		return { success: true, result: { updated, unreadCount: await countUnread(db, userId) } };
	}
}

export class NotificationsMarkAllRead extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Mark all notifications read",
		request: { headers: OptionalChannelHeader },
		responses: { "200": { description: "Updated count" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const updated = await markAllRead(db, this.getUserId(c));
		return { success: true, result: { updated, unreadCount: 0 } };
	}
}

export class NotificationsDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Delete a notification",
		request: { params: z.object({ id: Str() }), headers: OptionalChannelHeader },
		responses: {
			"200": { description: "Deleted" },
			"404": { description: "Not found", content: { "application/json": { schema: ResponseError } } },
			...unavailable,
		},
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const deleted = await deleteNotification(db, userId, params.id);
		if (!deleted) return c.json({ success: false, error: "Notification not found" }, 404);
		return { success: true, result: { id: params.id, unreadCount: await countUnread(db, userId) } };
	}
}

export class NotificationSettingsGet extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Notification settings per category",
		request: { headers: OptionalChannelHeader },
		responses: { "200": { description: "Settings" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		return { success: true, result: { settings: await getSettings(db, this.getUserId(c)), categories: NOTIFICATION_CATEGORIES } };
	}
}

const SettingsBody = z.object({
	settings: z.object(Object.fromEntries(NOTIFICATION_CATEGORIES.map((cat) => [cat, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>),
});

export class NotificationSettingsUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Update notification settings",
		request: { body: { content: { "application/json": { schema: SettingsBody } } }, headers: OptionalChannelHeader },
		responses: { "200": { description: "Updated settings" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const settings = await updateSettings(db, userId, body.settings);
		logger.debug("[Notifications] Settings updated", { userId, settings });
		return { success: true, result: { settings, categories: NOTIFICATION_CATEGORIES } };
	}
}

type ChannelType = z.infer<typeof Channel>;

/** Whether the user subscribes to the channel (as any of their channels), from the subscription store. */
async function isSubscribedInR2(c: AppContext, channelId: string, userId: string): Promise<boolean | null> {
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(channelId);
	if (!channel) return null;
	return isSubscribedTo(c.env.NOTIFICATIONS_DB, { ...channel, id: channelId }, { userId });
}

export class ChannelBellGet extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "My notification bell for a channel",
		request: { params: z.object({ channelId: Str() }), headers: OptionalChannelHeader },
		responses: { "200": { description: "{ bell, subscribed }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const bell = await getBell(db, params.channelId, userId);
		if (bell) return { success: true, result: { channelId: params.channelId, bell, subscribed: true } };

		// Not indexed yet (subscription event still queued, or pre-backfill): fall back to R2
		const subscribed = !!(await isSubscribedInR2(c, params.channelId, userId));
		return { success: true, result: { channelId: params.channelId, bell: subscribed ? "highlights" : null, subscribed } };
	}
}

export class ChannelBellUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Set my notification bell for a subscribed channel",
		request: {
			params: z.object({ channelId: Str() }),
			body: { content: { "application/json": { schema: z.object({ bell: z.enum(CHANNEL_BELL_LEVELS) }) } } },
			headers: OptionalChannelHeader,
		},
		responses: {
			"200": { description: "Bell saved" },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "Not subscribed to the channel", content: { "application/json": { schema: ResponseError } } },
			...unavailable,
		},
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);

		const indexed = await getBell(db, params.channelId, userId);
		if (!indexed) {
			const subscribed = await isSubscribedInR2(c, params.channelId, userId);
			if (subscribed === null) return c.json({ success: false, error: "Channel not found" }, 404);
			if (!subscribed) return c.json({ success: false, error: "not_subscribed" }, 409);
		}
		await setBell(db, params.channelId, userId, body.bell);
		logger.debug("[Notifications] Channel bell updated", { userId, channelId: params.channelId, bell: body.bell });
		return { success: true, result: { channelId: params.channelId, bell: body.bell, subscribed: true } };
	}
}
