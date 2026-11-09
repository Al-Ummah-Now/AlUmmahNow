import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { SITE_THEMES } from "@al-ummah/shared-types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from "../../lib/logger";
import { readSiteTheme, writeSiteTheme } from "../../lib/siteSettings";

const ThemeState = z.object({
  theme: z.enum(SITE_THEMES),
  isDefault: z.boolean(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export class SiteThemeGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Get the site theme",
    responses: {
      "200": { description: "Current site theme", content: { "application/json": { schema: z.object({ success: z.boolean(), result: ThemeState }) } } },
    },
  });

  async handle(c: AppContext) {
    return { success: true, result: await readSiteTheme(c.env.REPORTS_DB) };
  }
}

export class SiteThemePut extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Set the site theme",
    description: "Admins only. Changes the theme for the whole site and appends an audit row.",
    request: {
      body: { content: { "application/json": { schema: z.object({ theme: z.enum(SITE_THEMES) }) } } },
    },
    responses: {
      "200": { description: "Updated site theme", content: { "application/json": { schema: z.object({ success: z.boolean(), changed: z.boolean(), result: ThemeState }) } } },
      "403": { description: "Admin role required" },
    },
  });

  async handle(c: AppContext) {
    if (!this.isAdmin(c)) {
      logger.warn('[SiteTheme] Non-admin attempted a theme change', { userId: this.getUserId(c) });
      return c.json({ success: false, error: 'Admin role required' }, 403);
    }
    const { body } = await this.getValidatedData<typeof this.schema>();
    const actorId = this.getUserId(c);
    const changed = await writeSiteTheme(c.env.REPORTS_DB, body.theme, actorId, crypto.randomUUID(), new Date().toISOString());
    if (changed) logger.info('[SiteTheme] Site theme changed', { theme: body.theme, actorId });
    return { success: true, changed, result: await readSiteTheme(c.env.REPORTS_DB) };
  }
}
