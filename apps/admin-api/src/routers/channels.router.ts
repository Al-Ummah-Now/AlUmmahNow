import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ChannelVerificationGet, ChannelVerificationPut } from '../endpoints/channels/ChannelVerification';

const app = new Hono();
const channelsRouter = fromHono(app, { base: '' });

// Scholar / institution verification (Epic 6.1)
channelsRouter.get('/:channelId/verification', ChannelVerificationGet);
channelsRouter.put('/:channelId/verification', ChannelVerificationPut);

export default channelsRouter;
