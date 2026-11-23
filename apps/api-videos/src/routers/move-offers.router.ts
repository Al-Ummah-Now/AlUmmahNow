/**
 * Channel offers between an owner and one of the channel's admins (wiki AUN-CHANNEL-CLAIM §5).
 * Base: /api/move-offers. Making an offer is under the channel: POST /api/channels/:id/move-offers.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { MoveOfferAccept, MoveOfferCancel, MoveOfferDecline, MyMoveOffers } from '../endpoints/channel/channelMoveOffers';

export const moveOffersRouter = fromHono(new Hono());
moveOffersRouter.get('/', MyMoveOffers);
moveOffersRouter.post('/:id/accept', MoveOfferAccept);
moveOffersRouter.post('/:id/decline', MoveOfferDecline);
moveOffersRouter.delete('/:id', MoveOfferCancel);
