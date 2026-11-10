import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SiteThemeGet, SiteThemeHistory, SiteThemePut } from '../endpoints/siteSettings/SiteTheme';

const app = new Hono();
const siteSettingsRouter = fromHono(app, { base: '' });

siteSettingsRouter.get('/theme', SiteThemeGet);
siteSettingsRouter.put('/theme', SiteThemePut);
siteSettingsRouter.get('/theme/history', SiteThemeHistory);

export default siteSettingsRouter;
