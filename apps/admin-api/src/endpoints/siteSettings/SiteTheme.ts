import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { SITE_THEMES } from "@al-ummah/shared-types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from "../../lib/logger";
import { readSiteTheme, readSiteThemeHistory, writeSiteTheme } from "../../lib/siteSettings";

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

const ThemeChange = z.object({
  id: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string(),
  actorId: z.string(),
  createdAt: z.string(),
});

export class SiteThemeHistory extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Recent site theme changes",
    description: "The audit log of theme changes, newest first. Admins and moderators.",
    request: {
      query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
    },
    responses: {
      "200": { description: "Theme changes, newest first", content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ entries: z.array(ThemeChange) }) }) } } },
    },
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return { success: true, result: { entries: await readSiteThemeHistory(c.env.REPORTS_DB, query.limit) } };
  }
}
