import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { LiveStreamCreate } from '../endpoints/live/liveStreamCreate';
import { LiveStreamsList } from '../endpoints/live/liveStreamsList';
import { LiveStreamUpdate } from '../endpoints/live/liveStreamUpdate';
import { LiveChatList, LiveChatModerate, LiveChatPost, LiveChatSettingsUpdate } from '../endpoints/live/liveChat';
import { LiveReminderClear, LiveReminderSet } from '../endpoints/live/liveReminders';
import { PremiereSwap } from '../endpoints/live/premiere';
import { LiveStreamDelete, LiveStreamEnd, LiveStreamGet, LiveStreamIngestGet, LiveStreamQoe, LiveStreamStart, LiveStreamStateGet, LiveStreamViewers } from '../endpoints/live/liveSession';

const app = new Hono();
export const liveRouter = fromHono(app);

// Public endpoints
liveRouter.get('/', LiveStreamsList);
liveRouter.get('/:id', LiveStreamGet);
liveRouter.get('/:id/state', LiveStreamStateGet);
liveRouter.post('/:id/qoe', LiveStreamQoe);
liveRouter.post('/:id/viewers', LiveStreamViewers);

// Authenticated endpoints
liveRouter.post('/', LiveStreamCreate);
liveRouter.patch('/:id', LiveStreamUpdate);
liveRouter.delete('/:id', LiveStreamDelete);
// Provider-neutral session lifecycle (D3, lib/live/*)
liveRouter.get('/:id/ingest', LiveStreamIngestGet);
liveRouter.post('/:id/start', LiveStreamStart);
liveRouter.post('/:id/end', LiveStreamEnd);

// Reminders (wiki E17)
liveRouter.post('/:id/reminders', LiveReminderSet);
liveRouter.delete('/:id/reminders', LiveReminderClear);
// Premieres (wiki E17): another video before the start
liveRouter.patch('/:id/premiere', PremiereSwap);
// Live chat (wiki E17), behind the liveChat switch
liveRouter.get('/:id/chat', LiveChatList);
liveRouter.post('/:id/chat', LiveChatPost);
liveRouter.post('/:id/chat/:messageId/moderate', LiveChatModerate);
liveRouter.patch('/:id/chat/settings', LiveChatSettingsUpdate);

export default liveRouter;
