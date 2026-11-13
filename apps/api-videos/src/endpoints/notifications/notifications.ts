/**
 * Notification center (Story 29.10). All routes require authentication and
 * only ever touch the caller's own rows.
 *
 * GET    /api/notifications                       list (keyset cursor) + unreadCount, unseenCount, menuOpen
 * GET    /api/notifications/unread-count          { unreadCount, unseenCount, menuOpen }
 * POST   /api/notifications/seen                  { ids? } the menu was opened: clears the badge; in
 *                                                 `read` mode (platform setting) also marks ids read
 * POST   /api/notifications/read                  { ids } mark read
 * POST   /api/notifications/unread                { ids } mark unread
 * POST   /api/notifications/read-all              mark all read
 *
 * Every read-state change is pushed as `notifications_state` on `user:<userId>` so the
 * user's other tabs and devices update their badge and list.
 * DELETE /api/notifications/:id                   delete one
 * GET    /api/notifications/settings              per-category settings
 * PUT    /api/notifications/settings              { settings?: { category: boolean }, email?: { account?, locale? } }
 * GET    /api/notifications/channels/:channelId/bell   { bell, subscribed }
 * PUT    /api/notifications/channels/:channelId/bell   { bell: all|highlights|none }
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { isMemberSubscribedTo } from '../../lib/subscription-store';
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import {
	ALWAYS_ON_NOTIFICATION_CATEGORIES,
	CHANNEL_BELL_LEVELS,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_EMAIL_LOCALES,
	OPTIONAL_NOTIFICATION_CATEGORIES,
	type NotificationSettingsResult,
	type NotificationStateEvent,
	type NotificationSeenResult,
} from "@al-ummah/shared-types";
import { broadcastInBackground } from "../../lib/websocket-notify";
import {
	countState,
	markSeen,
	markUnread,
	readNotificationPlatformSettings,
	deleteNotification,
	getBell,
	getEmailSettings,
	getSettings,
	updateEmailSettings,
	listNotifications,
	markAllRead,
	markRead,
	MARK_READ_MAX_IDS,
	setBell,
	updateSettings,
} from "../../lib/notifications";
import { Channel, ResponseError } from "../../lib/types";

/** Tell the user's other tabs and devices (realtime, after the response). */
function pushState(c: AppContext, userId: string, state: Omit<NotificationStateEvent, "type">): void {
	broadcastInBackground(c, `user:${userId}`, "notifications_state", state as Record<string, unknown>);
}

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
		const [page, counts, platform] = await Promise.all([
			listNotifications(db, userId, { limit: query.limit, cursor: query.cursor, unreadOnly: query.unreadOnly === "true" }),
			countState(db, userId),
			readNotificationPlatformSettings(c.env),
		]);
		return { success: true, result: { ...page, ...counts, menuOpen: platform.menuOpen } };
	}
}

export class NotificationsUnreadCount extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Unread and unseen notification counts",
		description: "unseenCount (the bell's badge) counts unread notifications newer than the last time the user opened the menu. menuOpen is the platform setting for what opening the menu does.",
		request: { headers: OptionalChannelHeader },
		responses: { "200": { description: "{ unreadCount, unseenCount, menuOpen }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const [counts, platform] = await Promise.all([countState(db, this.getUserId(c)), readNotificationPlatformSettings(c.env)]);
		return { success: true, result: { ...counts, menuOpen: platform.menuOpen } };
	}
}

export class NotificationsMarkSeen extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "The notification menu was opened",
		description:
			"Clears the bell's badge (stores when the user last looked; idempotent, one row per user). When the platform setting menuOpen is `read`, the given ids (the notifications the menu shows) are also marked read. Other tabs and devices get a realtime `notifications_state` event.",
		request: {
			body: { content: { "application/json": { schema: z.object({ ids: z.array(Str()).max(MARK_READ_MAX_IDS).optional() }) } } },
			headers: OptionalChannelHeader,
		},
		responses: { "200": { description: "{ seenAt, menuOpen, readIds, unreadCount, unseenCount }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const platform = await readNotificationPlatformSettings(c.env);
		const seenAt = await markSeen(db, userId);
		const ids = platform.menuOpen === "read" ? [...new Set(body?.ids ?? [])].slice(0, MARK_READ_MAX_IDS) : [];
		if (ids.length > 0) await markRead(db, userId, ids);
		const counts = await countState(db, userId);
		const result: NotificationSeenResult = { ...counts, seenAt: new Date(seenAt).toISOString(), menuOpen: platform.menuOpen, readIds: ids };
		pushState(c, userId, { ...counts, seenAt: result.seenAt, ...(ids.length ? { readIds: ids } : {}) });
		logger.debug("[Notifications] Menu opened", { userId, menuOpen: platform.menuOpen, read: ids.length });
		return { success: true, result };
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
		const counts = await countState(db, userId);
		pushState(c, userId, { ...counts, readIds: body.ids });
		return { success: true, result: { updated, ...counts } };
	}
}

export class NotificationsMarkUnread extends AuthenticatedRoute {
	schema = {
		tags: ["Notifications"],
		summary: "Mark notifications unread",
		description: "They show as unread in the list again; they do not come back on the bell's badge.",
		request: {
			body: { content: { "application/json": { schema: z.object({ ids: z.array(Str()).min(1).max(MARK_READ_MAX_IDS) }) } } },
			headers: OptionalChannelHeader,
		},
		responses: { "200": { description: "Updated count and new counts" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return storeUnavailable(c);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const updated = await markUnread(db, userId, body.ids);
		const counts = await countState(db, userId);
		pushState(c, userId, { ...counts, unreadIds: body.ids });
		return { success: true, result: { updated, ...counts } };
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
		const userId = this.getUserId(c);
		const updated = await markAllRead(db, userId);
		pushState(c, userId, { unreadCount: 0, unseenCount: 0, allRead: true });
		return { success: true, result: { updated, unreadCount: 0, unseenCount: 0 } };
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
		const counts = await countState(db, userId);
		pushState(c, userId, { ...counts, deletedId: params.id });
		return { success: true, result: { id: params.id, ...counts } };
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
		const userId = this.getUserId(c);
		return { success: true, result: await settingsResult(db, userId) };
	}
}

async function settingsResult(db: D1Database, userId: string): Promise<NotificationSettingsResult> {
	const [settings, email] = await Promise.all([getSettings(db, userId), getEmailSettings(db, userId)]);
	return { settings, categories: NOTIFICATION_CATEGORIES, alwaysOn: ALWAYS_ON_NOTIFICATION_CATEGORIES, email };
}

// Always-on categories (account notices) are not settable
const SettingsBody = z.object({
	settings: z
		.object(Object.fromEntries(OPTIONAL_NOTIFICATION_CATEGORIES.map((cat) => [cat, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>)
		.optional(),
	email: z
		.object({
			account: z.boolean().optional().describe('Email me about my account (warnings and other account notices)'),
			locale: z.enum(NOTIFICATION_EMAIL_LOCALES).optional().describe('Language of the emails'),
		})
		.optional(),
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
		if (body.settings) await updateSettings(db, userId, body.settings);
		if (body.email) await updateEmailSettings(db, userId, body.email);
		const result = await settingsResult(db, userId);
		logger.debug("[Notifications] Settings updated", { userId, settings: result.settings, email: result.email });
		return { success: true, result };
	}
}

type ChannelType = z.infer<typeof Channel>;

/** Whether the user subscribes to the channel (as any of their channels), from the subscription store. */
async function isSubscribedInR2(c: AppContext, channelId: string, userId: string): Promise<boolean | null> {
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(channelId);
	if (!channel) return null;
	return isMemberSubscribedTo(c.env.NOTIFICATIONS_DB, { ...channel, id: channelId }, userId);
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
