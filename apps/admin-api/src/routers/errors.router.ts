import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import {
  ErrorCounts,
  ErrorFacets,
  ErrorGroupAddNote,
  ErrorGroupGet,
  ErrorGroupList,
  ErrorGroupUpdate,
  ErrorRefLookup,
  ErrorTestGroupDelete,
  ErrorActionRetry,
  ErrorActionUpdate,
} from '../endpoints/errors/ErrorsAdmin';

const app = new Hono();
const errorsRouter = fromHono(app, { base: '' });

// Errors page (admin-web /errors)
errorsRouter.get('/groups', ErrorGroupList);
errorsRouter.get('/counts', ErrorCounts);
errorsRouter.get('/facets', ErrorFacets);
errorsRouter.get('/refs/:ref', ErrorRefLookup);
errorsRouter.get('/groups/:id', ErrorGroupGet);
errorsRouter.patch('/groups/:id', ErrorGroupUpdate);
errorsRouter.post('/groups/:id/notes', ErrorGroupAddNote);
errorsRouter.delete('/test-groups/:ref', ErrorTestGroupDelete);
errorsRouter.post('/actions/:id/retry', ErrorActionRetry);
errorsRouter.patch('/actions/:id', ErrorActionUpdate);

export default errorsRouter;
