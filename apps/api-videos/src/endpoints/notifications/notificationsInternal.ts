/**
 * Platform notification settings (internal; admin-api proxies with the admin role and the audit row).
 *
 *   GET  /internal/notifications/settings   { menuOpen, updatedAt, updatedBy }
 *   PUT  /internal/notifications/settings   { menuOpen, actorId }
 *
 * menuOpen: what opening the notification menu does: `seen` clears the badge only (default),
 * `read` also marks the notifications the menu shows as read.
 */

import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { Hono } from 'hono';
import { readNotificationPlatformSettings, writeNotificationPlatformSettings } from '../../lib/notifications';
import { logger } from '../../lib/logger';
type Env = { global_settings?: R2Bucket };

const Settings = z.object({ actorId: RecordId, menuOpen: z.enum(['seen', 'read']) });

export function createNotificationsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/settings', async (c) => c.json({ success: true, result: await readNotificationPlatformSettings(c.env, true) }));

	app.put('/settings', async (c) => {
		const parsed = Settings.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'actorId and menuOpen (seen or read) are required' }, 400);
		const body = parsed.data;
		const result = await writeNotificationPlatformSettings(c.env, { menuOpen: body.menuOpen }, body.actorId);
		logger.info('[Notifications] Platform settings changed', { menuOpen: result.menuOpen, actorId: body.actorId });
		return c.json({ success: true, result });
	});

	return app;
}
