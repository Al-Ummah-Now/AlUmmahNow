/**
 * Owners' channel offers on the admin channel page (wiki AUN-CHANNEL-CLAIM §5, CC-7b). A channel has
 * one open offer at most (idx_channel_move_offers_open), so the list is that one or empty.
 */
import type { AdminChannelMoveOffer } from '@al-ummah/shared-types';
import { isOpenOffer, type MoveOfferRow } from '../channelMoves';
import { keepsContactEmail, OPEN_OFFER_SQL } from '../channelMoveViews';
import { bansFor } from './bans';
import { readMany, toUserRow, type AdminEnv } from './directory';

export async function channelMoveOffers(env: AdminEnv, channelId: string, now = Date.now()): Promise<{ offers: AdminChannelMoveOffer[] }> {
	const db = env.SEARCH_DB!;
	const offer = await (db as unknown as D1Database).prepare(OPEN_OFFER_SQL).bind(channelId).first<MoveOfferRow>();
	if (!offer || !isOpenOffer(offer, now)) return { offers: [] };
	const ids = [offer.from_user_id, offer.to_user_id];
	const [profiles, bans] = await Promise.all([readMany(env.profiles, ids), bansFor(db, ids)]);
	const person = (id: string) => toUserRow(id, profiles.get(id) ?? null, bans.has(id));
	return {
		offers: [
			{
				id: offer.id,
				status: offer.status as AdminChannelMoveOffer['status'],
				from: person(offer.from_user_id),
				to: person(offer.to_user_id),
				keepContactEmail: keepsContactEmail(offer),
				createdAt: offer.created_at,
				expiresAt: offer.expires_at,
			},
		],
	};
}
