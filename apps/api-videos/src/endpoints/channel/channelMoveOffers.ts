/**
 * Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5): the owner offers the channel to one of its
 * channel admins, who accepts or declines. Behind the switch `channelMove` (FEATURE_ROUTES answer
 * 404 feature_off while it is off). The logic is lib/channelMoves.ts.
 */
import { z } from 'zod';
import { AppContext, AuthenticatedRoute } from '../../base';
import { ResponseError } from '../../lib/types';
import { NO_STORE } from './channelMembers';
import { apiError } from '../../lib/api-error';
import { channelMoveState, offerViews, readOfferView } from '../../lib/channelMoveViews';
import { acceptMoveOffer, cancelMoveOffer, createMoveOffer, declineMoveOffer, moveReceivers, MOVE_OFFERS_PAGE, MoveError, myMoveOffers, type MoveOfferPage, type MoveOfferRow } from '../../lib/channelMoves';

const ChannelParams = z.object({ id: z.string().min(1).max(200).describe('Channel id') });
const OfferParams = z.object({ id: z.string().min(1).max(200).describe('Offer id') });
const Offer = z.object({ id: z.string(), channelId: z.string(), status: z.string(), createdAt: z.string(), expiresAt: z.string() });
const errors = {
	'403': { description: 'move_not_owner or reauth_required', content: { 'application/json': { schema: ResponseError } } },
	'404': { description: 'channel_not_found or offer_not_found', content: { 'application/json': { schema: ResponseError } } },
	'409': {
		description: 'receiver_not_channel_admin, official_handle, move_channel_suspended, channel_under_review, owner_changed, move_in_progress, move_channel_live, move_channel_has_support, move_receiver_not_allowed, move_receiver_channel_limit, moved_recently, offer_open',
		content: { 'application/json': { schema: ResponseError } },
	},
	'503': { description: 'move_check_unavailable', content: { 'application/json': { schema: ResponseError } } },
};

const Person = z.object({ name: z.string().nullable(), nameLocalized: z.record(z.string(), z.string()).optional(), avatarUrl: z.string().nullable() });
const OfferView = z.object({
	id: z.string(),
	status: z.enum(['offered', 'accepting', 'moved', 'declined', 'cancelled', 'expired', 'stopped', 'refused']),
	createdAt: z.string(),
	expiresAt: z.string(),
	respondedAt: z.string().nullable(),
	keepContactEmail: z.boolean(),
	channel: z.object({ id: z.string(), name: z.string().nullable(), nameLocalized: z.record(z.string(), z.string()).optional(), handle: z.string().nullable(), avatarUrl: z.string().nullable() }),
	from: Person,
	to: Person,
	viewerRole: z.enum(['from', 'to', 'owner']),
});

const view = (o: MoveOfferRow) => ({ id: o.id, channelId: o.channel_id, status: o.status, createdAt: o.created_at, expiresAt: o.expires_at });

/**
 * The codes these routes answer where the move's own code also belongs to other routes (Go live,
 * handle edits, scholar posts, admin transfers, invites): the catalogue texts here are about an
 * owner's move, and those routes keep theirs.
 */
export const MOVE_ROUTE_CODES: Readonly<Record<string, string>> = {
	not_owner: 'move_not_owner',
	already_owner: 'move_already_owner',
	confirm_mismatch: 'move_confirm_mismatch',
	transfer_in_progress: 'move_in_progress',
	transfer_unfinished: 'move_in_progress',
	channel_is_live: 'move_channel_live',
	channel_has_support: 'move_channel_has_support',
	channel_suspended: 'move_channel_suspended',
	official_handle_confirm: 'official_handle',
	new_owner_banned: 'move_receiver_not_allowed',
	new_owner_not_found: 'move_receiver_not_allowed',
	new_owner_channel_limit: 'move_receiver_channel_limit',
	unavailable: 'service_unavailable',
};

function refused(c: AppContext, error: unknown) {
	if (error instanceof MoveError) {
		const code = MOVE_ROUTE_CODES[error.code] ?? error.code;
		// A MoveError without its own words carries its code as the message
		return apiError(c, error.status, code, { error: error.message === error.code ? code : error.message }, NO_STORE);
	}
	throw error;
}

export class ChannelMoveReceivers extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Who the owner can move the channel to',
		description: '🔒 Owner only. The channel’s current admins (channel roles), matched on name. A channel moves only to one of its admins, picked by user id.',
		request: { params: ChannelParams, query: z.object({ q: z.string().max(200).nullish().describe('Empty or missing: every admin') }) },
		responses: {
			'200': { description: 'The channel’s admins', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ items: z.array(z.object({ userId: z.string(), name: z.string().nullable(), nameLocalized: z.record(z.string(), z.string()).optional(), avatarUrl: z.string().nullable() })) }) }) } } },
			...errors,
		},
	};
	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		try {
			return c.json({ success: true, data: { items: await moveReceivers(c.env as never, params.id, this.getUserId(c), query.q ?? '') } }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}

export class ChannelMoveOfferCreate extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Offer the channel to one of its admins',
		description: '🔒 Owner only, signed in within the last 10 minutes, with the channel’s @handle typed. The admin accepts or declines within 7 days.',
		request: {
			params: ChannelParams,
			body: { content: { 'application/json': { schema: z.object({ toUserId: z.string().min(1).max(200), confirm: z.string().max(200), keepContactEmail: z.boolean().optional() }) } } },
		},
		responses: { '200': { description: 'Offer made', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: Offer }) } } }, ...errors },
	};
	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const auth = c.get('auth') as { payload?: { authTime?: number } } | undefined;
		try {
			const offer = await createMoveOffer(c.env as never, { channelId: params.id, ownerId: this.getUserId(c), toUserId: body.toUserId, typed: body.confirm, keepContactEmail: body.keepContactEmail, authTime: auth?.payload?.authTime ?? 0 });
			return c.json({ success: true, data: view(offer) }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}

export class MyMoveOffers extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'My open channel offers',
		description: `🔒 Offers made to me and by me that are still open (being accepted included), newest first, with the channel and both people by name. ${MOVE_OFFERS_PAGE} of each side; for more, \`side\` with that side’s cursor.`,
		request: { query: z.object({ side: z.enum(['received', 'sent']).optional(), cursor: z.string().regex(/^\d{1,15}$/).optional() }) },
		responses: { '200': { description: 'Open offers', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ received: z.array(OfferView), sent: z.array(OfferView), receivedCursor: z.string().nullable(), sentCursor: z.string().nullable() }) }) } } } },
	};
	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const none: MoveOfferPage = { offers: [], cursor: null };
		try {
			const userId = this.getUserId(c);
			// A cursor is one side's
			const page = (side: 'received' | 'sent') => (query.side && query.side !== side ? none : myMoveOffers(c.env as never, userId, side, query.side ? query.cursor : null));
			const [received, sent] = await Promise.all([page('received'), page('sent')]);
			const views = new Map((await offerViews(c.env as never, [...received.offers, ...sent.offers], userId)).map((v) => [v.id, v]));
			const of = (p: MoveOfferPage) => p.offers.flatMap((o) => views.get(o.id) ?? []);
			return c.json({ success: true, data: { received: of(received), sent: of(sent), receivedCursor: received.cursor, sentCursor: sent.cursor } }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}

export class MoveOfferFetch extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'A channel offer',
		description: '🔒 The two people of the offer and the channel’s owner; 404 for anyone else. Answered for closed offers too, so a notice’s page can say what happened.',
		request: { params: OfferParams },
		responses: { '200': { description: 'The offer', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: OfferView }) } } }, '404': { description: 'offer_not_found', content: { 'application/json': { schema: ResponseError } } } },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const offer = await readOfferView(c.env as never, params.id, this.getUserId(c));
		if (!offer) return apiError(c, 404, 'offer_not_found', undefined, NO_STORE);
		return c.json({ success: true, data: offer }, 200, NO_STORE);
	}
}

export class ChannelMoveStateFetch extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'The channel’s open offer',
		description: '🔒 Owner only; 404 for anyone else. The open offer, if any, and from when the owner may move the channel again (`movableAt`; null: now).',
		request: { params: ChannelParams },
		responses: { '200': { description: 'The open offer', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ offer: OfferView.nullable(), movableAt: z.string().nullable() }) }) } } }, '404': { description: 'channel_not_found', content: { 'application/json': { schema: ResponseError } } } },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const state = await channelMoveState(c.env as never, params.id, this.getUserId(c));
		if (!state) return apiError(c, 404, 'channel_not_found', undefined, NO_STORE);
		return c.json({ success: true, data: state }, 200, NO_STORE);
	}
}

export class MoveOfferAccept extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Accept a channel offer',
		description: '🔒 The admin the offer was made to. The move starts at once; the previous owner keeps no access.',
		request: { params: OfferParams },
		responses: { '200': { description: 'Move started', content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ jobId: z.string() }) }) } } }, ...errors },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		try {
			const { jobId } = await acceptMoveOffer(c.env as never, params.id, this.getUserId(c));
			return c.json({ success: true, data: { jobId } }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}

export class MoveOfferDecline extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Decline a channel offer',
		description: '🔒 The admin the offer was made to. The owner is told.',
		request: { params: OfferParams },
		responses: { '200': { description: 'Declined', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } }, '404': errors['404'] },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		try {
			await declineMoveOffer(c.env as never, params.id, this.getUserId(c));
			return c.json({ success: true }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}

export class MoveOfferCancel extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Withdraw a channel offer',
		description: '🔒 The owner who made it. The admin is told.',
		request: { params: OfferParams },
		responses: { '200': { description: 'Withdrawn', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } }, '404': errors['404'] },
	};
	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		try {
			await cancelMoveOffer(c.env as never, params.id, this.getUserId(c));
			return c.json({ success: true }, 200, NO_STORE);
		} catch (error) {
			return refused(c, error);
		}
	}
}
