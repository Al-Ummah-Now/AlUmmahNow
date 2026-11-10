import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { isBuiltInSiteTheme } from "@al-ummah/shared-types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from "../../lib/logger";
import { readSiteTheme, readSiteThemeHistory, writeSiteTheme } from "../../lib/siteSettings";
import type { SiteThemeRef } from "@al-ummah/shared-types";

const ThemeState = z.object({
  theme: z.string(),
  version: z.string().nullable(),
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
    description: "Admins only. Changes the theme for the whole site and appends an audit row. A built-in theme is its id; a theme package made in the theme builder also needs a published version.",
    request: {
      body: { content: { "application/json": { schema: z.object({ theme: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/), version: z.string().regex(/^\d+\.\d+\.\d+$/).optional() }) } } },
    },
    responses: {
      "200": { description: "Updated site theme", content: { "application/json": { schema: z.object({ success: z.boolean(), changed: z.boolean(), result: ThemeState }) } } },
      "403": { description: "Admin role required" },
      "404": { description: "No such theme or published version" },
    },
  });

  async handle(c: AppContext) {
    if (!this.isAdmin(c)) {
      logger.warn('[SiteTheme] Non-admin attempted a theme change', { userId: this.getUserId(c) });
      return c.json({ success: false, error: 'Admin role required' }, 403);
    }
    const { body } = await this.getValidatedData<typeof this.schema>();
    const actorId = this.getUserId(c);
    let ref: SiteThemeRef;
    if (isBuiltInSiteTheme(body.theme)) {
      ref = { id: body.theme, version: null };
    } else {
      if (!body.version) return c.json({ success: false, error: 'A custom theme needs its published version' }, 400);
      const published = await c.env.REPORTS_DB
        .prepare('SELECT v.version FROM theme_package_versions v JOIN theme_packages t ON t.id = v.theme_id AND t.deleted_at IS NULL WHERE v.theme_id = ? AND v.version = ?')
        .bind(body.theme, body.version)
        .first<{ version: string }>();
      if (!published) return c.json({ success: false, error: `${body.theme}@${body.version} is not a published theme` }, 404);
      ref = { id: body.theme, version: body.version };
    }
    const changed = await writeSiteTheme(c.env.REPORTS_DB, ref, actorId, crypto.randomUUID(), new Date().toISOString());
    if (changed) logger.info('[SiteTheme] Site theme changed', { theme: body.theme, version: ref.version, actorId });
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
