import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ContactAddNote, ContactBulk, ContactCounts, ContactRestore, ContactStaff, ContactDelete, ContactGet, ContactList, ContactQueue, ContactReply, ContactRetryDelivery, ContactUpdate } from '../endpoints/contact/ContactAdmin';

const app = new Hono();
const contactRouter = fromHono(app, { base: '' });

// Contact us inbox (admin-web /contact)
contactRouter.get('/messages', ContactList);
contactRouter.get('/counts', ContactCounts);
// Assignee picker: admins on the inbox roster
contactRouter.get('/staff', ContactStaff);
// Bulk bar: one change on many messages, and Undo of a delete
contactRouter.post('/messages/bulk', ContactBulk);
contactRouter.post('/messages/restore', ContactRestore);
// Action needed / History tabs (docs/admin/QUEUES.md)
contactRouter.get('/queue', ContactQueue);
contactRouter.get('/messages/:id', ContactGet);
contactRouter.patch('/messages/:id', ContactUpdate);
contactRouter.delete('/messages/:id', ContactDelete);
contactRouter.post('/messages/:id/notes', ContactAddNote);
contactRouter.post('/messages/:id/reply', ContactReply);
contactRouter.post('/messages/:id/retry', ContactRetryDelivery);

export default contactRouter;
