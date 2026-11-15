import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SiteThemeGet, SiteThemeHistory, SiteThemePut } from '../endpoints/siteSettings/SiteTheme';
import { MobileAppsGet, MobileAppsHistory, MobileAppsPut } from '../endpoints/mobileApps/MobileApps';

const app = new Hono();
const siteSettingsRouter = fromHono(app, { base: '' });

siteSettingsRouter.get('/theme', SiteThemeGet);
siteSettingsRouter.put('/theme', SiteThemePut);
siteSettingsRouter.get('/theme/history', SiteThemeHistory);
siteSettingsRouter.get('/mobile-apps', MobileAppsGet);
siteSettingsRouter.put('/mobile-apps', MobileAppsPut);
siteSettingsRouter.get('/mobile-apps/history', MobileAppsHistory);

export default siteSettingsRouter;
