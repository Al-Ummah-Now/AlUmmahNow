/**
 * Studio account routes (institution mode, E19 19.9): brand kit and shared assets.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { BrandKitGet, BrandKitPut, StudioAssetCreate, StudioAssetDelete, StudioAssetGet, StudioAssetsList } from '../endpoints/studio/brandKit';

const app = new Hono();

export const studioRouter = fromHono(app);

studioRouter.get('/brand-kit', BrandKitGet);
studioRouter.put('/brand-kit', BrandKitPut);
studioRouter.get('/assets', StudioAssetsList);
studioRouter.post('/assets', StudioAssetCreate);
studioRouter.get('/assets/:assetId', StudioAssetGet);
studioRouter.delete('/assets/:assetId', StudioAssetDelete);

export default studioRouter;
