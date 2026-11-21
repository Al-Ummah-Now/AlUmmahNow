/**
 * My channel invitations (docs/specs/CHANNEL-ROLES.md §13). Base: /api/channel-invites.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ChannelInviteAccept, ChannelInviteDecline, MyChannelInvites } from '../endpoints/channel/channelInvites';

export const channelInvitesRouter = fromHono(new Hono());
channelInvitesRouter.get('/', MyChannelInvites);
channelInvitesRouter.post('/:id/accept', ChannelInviteAccept);
channelInvitesRouter.post('/:id/decline', ChannelInviteDecline);
