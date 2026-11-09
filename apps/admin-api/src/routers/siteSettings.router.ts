import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SiteThemeGet, SiteThemePut } from '../endpoints/siteSettings/SiteTheme';

const app = new Hono();
const siteSettingsRouter = fromHono(app, { base: '' });

siteSettingsRouter.get('/theme', SiteThemeGet);
siteSettingsRouter.put('/theme', SiteThemePut);

export default siteSettingsRouter;
