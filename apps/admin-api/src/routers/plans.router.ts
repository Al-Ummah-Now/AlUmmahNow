import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import * as e from '../endpoints/plans';

const app = new Hono();
const plansRouter = fromHono(app, { base: '' });

plansRouter.get('/catalogue', e.CatalogueGet);
plansRouter.get('/audit', e.AuditList);
plansRouter.get('/subjects/:subject', e.SubjectGet);
plansRouter.put('/subjects/:subject/assignment', e.AssignmentSet);
plansRouter.post('/subjects/:subject/assignment/cancel', e.AssignmentCancel);
plansRouter.put('/subjects/:subject/overrides', e.OverrideSet);
plansRouter.post('/subjects/:subject/overrides/remove', e.OverrideRemove);
plansRouter.get('/', e.PlansList);
plansRouter.post('/', e.PlanCreate);
plansRouter.get('/:id', e.PlanGet);
plansRouter.patch('/:id', e.PlanUpdate);
plansRouter.put('/:id/values', e.PlanValuesSet);
plansRouter.post('/:id/publish', e.PlanPublish);
plansRouter.post('/:id/archive', e.PlanArchive);
plansRouter.post('/:id/migrate', e.PlanMigrate);

export default plansRouter;
