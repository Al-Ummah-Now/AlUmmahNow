/**
 * Platform notification settings (internal; admin-api proxies with the admin role and the audit row).
 *
 *   GET  /internal/notifications/settings   { menuOpen, updatedAt, updatedBy }
 *   PUT  /internal/notifications/settings   { menuOpen, actorId }
 *
 * menuOpen: what opening the notification menu does: `seen` clears the badge only (default),
 * `read` also marks the notifications the menu shows as read.
 */

import { Hono } from 'hono';
import { isNotificationMenuOpenMode } from '@al-ummah/shared-types';
import { readNotificationPlatformSettings, writeNotificationPlatformSettings } from '../../lib/notifications';
import { logger } from '../../lib/logger';
type Env = { global_settings?: R2Bucket };

export function createNotificationsInternalRouter() {
	const app = new Hono<{ Bindings: Env }>();

	app.get('/settings', async (c) => c.json({ success: true, result: await readNotificationPlatformSettings(c.env, true) }));

	app.put('/settings', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { menuOpen?: unknown; actorId?: unknown } | null;
		if (!body || typeof body.actorId !== 'string' || !body.actorId) return c.json({ success: false, error: 'actorId is required' }, 400);
		if (!isNotificationMenuOpenMode(body.menuOpen)) return c.json({ success: false, error: 'menuOpen must be seen or read' }, 400);
		const result = await writeNotificationPlatformSettings(c.env, { menuOpen: body.menuOpen }, body.actorId);
		logger.info('[Notifications] Platform settings changed', { menuOpen: result.menuOpen, actorId: body.actorId });
		return c.json({ success: true, result });
	});

	return app;
}
