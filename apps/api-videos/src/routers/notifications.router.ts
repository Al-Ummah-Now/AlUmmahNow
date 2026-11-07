/**
 * Notifications Domain Router (Story 29.10)
 *
 * Routes (relative to base /api/notifications), all authenticated:
 * - GET    /                              List (cursor) + unreadCount
 * - GET    /unread-count                  Unread count
 * - POST   /read                          Mark { ids } read
 * - POST   /read-all                      Mark all read
 * - GET    /settings                      Per-category settings
 * - PUT    /settings                      Update settings
 * - GET    /channels/:channelId/bell      Per-channel bell
 * - PUT    /channels/:channelId/bell      Set per-channel bell (all | highlights | none)
 * - DELETE /:id                           Delete one
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import {
  ChannelBellGet,
  ChannelBellUpdate,
  NotificationSettingsGet,
  NotificationSettingsUpdate,
  NotificationsDelete,
  NotificationsList,
  NotificationsMarkAllRead,
  NotificationsMarkRead,
  NotificationsUnreadCount,
} from '../endpoints/notifications/notifications';

const app = new Hono();

export const notificationsRouter = fromHono(app, { base: '/api/notifications' });

notificationsRouter.get('/', NotificationsList);
notificationsRouter.get('/unread-count', NotificationsUnreadCount);
notificationsRouter.post('/read', NotificationsMarkRead);
notificationsRouter.post('/read-all', NotificationsMarkAllRead);
notificationsRouter.get('/settings', NotificationSettingsGet);
notificationsRouter.put('/settings', NotificationSettingsUpdate);
notificationsRouter.get('/channels/:channelId/bell', ChannelBellGet);
notificationsRouter.put('/channels/:channelId/bell', ChannelBellUpdate);
notificationsRouter.delete('/:id', NotificationsDelete);

export default notificationsRouter;
