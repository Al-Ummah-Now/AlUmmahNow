import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { IndexOperations } from '../endpoints/indices/IndexOperations';

const app = new Hono();
const indicesRouter = fromHono(app, { base: '' });

// Index management operations
indicesRouter.get('/', IndexOperations);

export default indicesRouter;
