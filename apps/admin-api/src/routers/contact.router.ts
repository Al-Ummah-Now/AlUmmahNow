import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ContactAddNote, ContactCounts, ContactDelete, ContactGet, ContactList, ContactReply, ContactRetryDelivery, ContactUpdate } from '../endpoints/contact/ContactAdmin';

const app = new Hono();
const contactRouter = fromHono(app, { base: '' });

// Contact us inbox (admin-web /contact)
contactRouter.get('/messages', ContactList);
contactRouter.get('/counts', ContactCounts);
contactRouter.get('/messages/:id', ContactGet);
contactRouter.patch('/messages/:id', ContactUpdate);
contactRouter.delete('/messages/:id', ContactDelete);
contactRouter.post('/messages/:id/notes', ContactAddNote);
contactRouter.post('/messages/:id/reply', ContactReply);
contactRouter.post('/messages/:id/retry', ContactRetryDelivery);

export default contactRouter;
