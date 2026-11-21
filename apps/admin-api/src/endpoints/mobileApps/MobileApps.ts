import { AdminRoute, AppContext } from "../../base";
import { z } from "zod";
import { MobileAppsSettingsSchema, appleAppSiteAssociation, assetLinks, publicAttestationConfig } from "@al-ummah/shared-types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from "../../lib/logger";
import { mobileAppsEnvironment, readMobileApps, readMobileAppsHistory, writeMobileApps } from "../../lib/mobileApps";

/** What the page shows next to the form: the files and attestation config these values produce. */
function preview(settings: Parameters<typeof appleAppSiteAssociation>[0]) {
  return {
    appleAppSiteAssociation: appleAppSiteAssociation(settings),
    assetLinks: assetLinks(settings),
    attestation: publicAttestationConfig(settings),
  };
}

const StateResponse = z.object({ success: z.boolean(), result: z.record(z.string(), z.unknown()) });

export class MobileAppsGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Get the mobile apps settings",
    description: "Apple Team ID and bundle ids, Android packages and signing-certificate fingerprints, and attestation switches, with the domain association files they produce. Admins and moderators.",
    responses: {
      "200": { description: "Current settings", content: { "application/json": { schema: StateResponse } } },
    },
  });

  async handle(c: AppContext) {
    const state = await readMobileApps(c.env.REPORTS_DB, mobileAppsEnvironment(c.env.ENVIRONMENT));
    return { success: true, result: { ...state, preview: preview(state.settings) } };
  }
}

export class MobileAppsPut extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Save the mobile apps settings",
    description: "Admins only. Replaces the whole document and appends an audit row. Empty values publish nothing: the videos site serves its domain association files only once they list an app, and attestation stays off until switched on with the values it needs.",
    request: {
      body: { content: { "application/json": { schema: z.object({ settings: z.record(z.string(), z.unknown()) }) } } },
    },
    responses: {
      "200": { description: "Saved settings", content: { "application/json": { schema: StateResponse } } },
      "400": { description: "A value is not valid (issues name the field)" },
      "403": { description: "Admin role required" },
    },
  });

  async handle(c: AppContext) {
    if (!this.isAdmin(c)) {
      logger.warn('[MobileApps] Non-admin attempted a change', { userId: this.getUserId(c) });
      return c.json({ success: false, error: 'Admin role required' }, 403);
    }
    const { body } = await this.getValidatedData<typeof this.schema>();
    const parsed = MobileAppsSettingsSchema.safeParse(body.settings);
    if (!parsed.success) {
      return c.json({ success: false, error: 'invalid_settings', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
    }
    const environment = mobileAppsEnvironment(c.env.ENVIRONMENT);
    const actorId = this.getUserId(c);
    const changed = await writeMobileApps(c.env.REPORTS_DB, parsed.data, actorId, crypto.randomUUID(), new Date().toISOString());
    if (changed) logger.info('[MobileApps] Settings changed', { actorId });
    const state = await readMobileApps(c.env.REPORTS_DB, environment);
    return { success: true, changed, result: { ...state, preview: preview(state.settings) } };
  }
}

export class MobileAppsHistory extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Site settings"],
    summary: "Recent mobile apps settings changes",
    description: "The audit log, newest first, with the values before and after. Admins and moderators.",
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) },
    responses: {
      "200": { description: "Changes, newest first", content: { "application/json": { schema: StateResponse } } },
    },
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const entries = await readMobileAppsHistory(c.env.REPORTS_DB, mobileAppsEnvironment(c.env.ENVIRONMENT), query.limit);
    return { success: true, result: { entries } };
  }
}
