/**
 * Settings Router
 * Routes for user settings including upload defaults (templates)
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import upload defaults endpoints
import {
  ListUploadDefaultsEndpoint,
  CreateUploadDefaultEndpoint,
} from '../endpoints/settings/uploadDefaults';
import {
  GetUploadDefaultEndpoint,
  UpdateUploadDefaultEndpoint,
  DeleteUploadDefaultEndpoint,
  SetDefaultTemplateEndpoint,
} from '../endpoints/settings/uploadDefaultsById';

const app = new Hono();

export const settingsRouter = fromHono(app, { base: '/api/upload-defaults' });

// Upload Defaults (Templates) routes
// All routes are relative to base: /api/upload-defaults

// Collection endpoints
settingsRouter.get('/', ListUploadDefaultsEndpoint);
settingsRouter.post('/', CreateUploadDefaultEndpoint);

// Individual template endpoints
settingsRouter.get('/:id', GetUploadDefaultEndpoint);
settingsRouter.put('/:id', UpdateUploadDefaultEndpoint);
settingsRouter.delete('/:id', DeleteUploadDefaultEndpoint);

// Set default template
settingsRouter.put('/:id/default', SetDefaultTemplateEndpoint);

export default settingsRouter;
