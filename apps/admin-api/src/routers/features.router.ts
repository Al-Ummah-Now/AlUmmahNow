/**
 * The videos admin Features page API (FEAT-4, wiki AUN-FEATURES §3–§5.3, decision O39):
 *
 *   GET  /api/features                    features:read    every switch, in registry order
 *   PUT  /api/features/:key               features:manage  { enabled, expectedVersion, undo? }
 *   GET  /api/features/:key/history       features:read    changes, newest first, 50 per page
 *
 * Switches live in the search D1 (shared-types feature-switch-store.ts); api-videos reports the
 * old settings and whether each feature is set up (GET /internal/admin/features/state). A change
 * reaches every server within 30 s and every app within 2 minutes. The super-admin-only switches
 * need super admin as well; a switch with a precondition (lib/feature-preconditions.ts) is refused
 * with its reason. Every change is audited (site_settings_log key `feature:<key>`).
 */
import { Hono, type Context } from 'hono';
import {
  FEATURE_REGISTRY,
  FEATURE_SETUP_NOTES,
  blockedBy,
  isFeatureKey,
  isSuperAdmin,
  errorLangOf,
  readFeatureSwitches,
  readSwitchHistory,
  readSwitchRows,
  workflowDomainVisible,
  writeFeatureSwitch,
  SwitchWriteError,
  DEFAULT_FEATURE_SWITCHES,
  type FeatureDefinition,
  type FeatureKey,
  type FeatureStateReport,
} from '@al-ummah/shared-types';
import { hasPermission, type Permission } from '../lib/roles';
import { logger } from '../lib/logger';
import { resolveNames } from '../lib/queue/names';
import { auditOriginJson } from '../lib/request-origin';
import { callVideos, type VideosClientEnv } from '../lib/content/videosClient';
import { newsletterConfigured } from '../lib/public-features';
import { checkCanTurnOn, FEATURE_PRECONDITIONS, type FeaturePrecondition } from '../lib/feature-preconditions';
import { apiError } from '../lib/api-error';
import { proposeChange, ruleNeedsApproval, WorkflowError } from '../lib/workflows/engine';
import { registerFeatureExecutor } from '../lib/workflows/feature-actions';
import { seesMoney as workflowSeesMoney, workflowCtx } from './workflows.router';
import { stepUpAnswer } from '../middleware/passkeys';
import type { AdminBindings, AuthContext } from '../base/types';
import type { D1Database } from '../lib/types';

type Env = { Bindings: AdminBindings & VideosClientEnv & { FEATURES_FORCE_OFF?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

/** What the page says about how fast a change lands (wiki §5.3: every app within 2 minutes). */
export const FEATURE_PROPAGATION_SECONDS = 120;

export interface FeatureItem {
  key: FeatureKey;
  enabled: boolean;
  effective: boolean;
  blockedBy: FeatureKey[];
  ready: boolean;
  setupNote: { en: string; ar: string } | null;
  envOverride: boolean;
  /** Background work waiting for this switch (FEAT-5 fills it in) */
  parked: number;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
  canToggle: boolean;
  /** A change waiting for approval (wiki AUN-WORKFLOWS WF-9): the row shows it and the switch waits */
  pending: { requestId: string; enabled: boolean } | null;
}

const EMPTY_STATE: FeatureStateReport = { legacy: {}, ready: {} };

const roles = (c: C) => c.get('auth')?.roles;
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const forbidden = (c: C, permission: Permission | 'super_admin') => {
  logger.warn('[Features] Permission denied', { userId: actorOf(c), permission, path: c.req.path });
  return apiError(c, 403, 'forbidden', { error: `Missing permission ${permission}` });
};

/** May this caller change this switch? */
export function canToggle(callerRoles: readonly string[] | undefined, def: FeatureDefinition): boolean {
  return hasPermission(callerRoles, 'features:manage') && (def.toggle !== 'superAdmin' || isSuperAdmin(callerRoles ?? []));
}

/**
 * Switch changes waiting for approval, by feature: one read of the open-request lock index
 * (idx_workflow_requests_open). A failure only hides the pending marks. `seesMoney`: whether the reader
 * sees money, asked only when a row is stored outside the open domains (as on the Approvals pages).
 */
async function pendingSwitchChanges(db: D1Database | undefined, seesMoney: () => Promise<boolean>): Promise<Map<FeatureKey, { requestId: string; enabled: boolean }>> {
  const out = new Map<FeatureKey, { requestId: string; enabled: boolean }>();
  if (!db) return out;
  const keys = FEATURE_REGISTRY.map((d) => `features.set:feature:${d.key}`);
  try {
    const { results } = await db
      .prepare(`SELECT id, target_id, payload, domain FROM workflow_requests WHERE open_key IN (${keys.map(() => '?').join(', ')})`)
      .bind(...keys)
      .all<{ id: string; target_id: string; payload: string; domain: string }>();
    for (const r of results ?? []) {
      if (!isFeatureKey(r.target_id) || (!workflowDomainVisible(r.domain, false) && !(await seesMoney()))) continue;
      const enabled = (JSON.parse(r.payload) as { enabled?: unknown }).enabled;
      out.set(r.target_id, { requestId: r.id, enabled: enabled === true });
    }
  } catch (error) {
    logger.warn('[Features] Pending changes unavailable', { error: error instanceof Error ? error.message : String(error) });
  }
  return out;
}

/** api-videos' report; an outage leaves old settings unknown (defaults) and readiness unknown. */
async function readState(c: C): Promise<{ state: FeatureStateReport; available: boolean }> {
  try {
    return { state: await callVideos<FeatureStateReport>(c.env, '/features/state', { actorId: actorOf(c) }), available: true };
  } catch (error) {
    logger.warn('[Features] api-videos state unavailable', { error: error instanceof Error ? error.message : String(error) });
    return { state: EMPTY_STATE, available: false };
  }
}

export function createFeaturesRouter(checks: Partial<Record<FeatureKey, FeaturePrecondition>> = FEATURE_PRECONDITIONS) {
  const app = new Hono<Env>();
  registerFeatureExecutor(checks);

  app.get('/', async (c) => {
    if (!hasPermission(roles(c), 'features:read')) return forbidden(c, 'features:read');
    const [{ state, available }, newsletterReady] = await Promise.all([readState(c), newsletterConfigured(c.env as never)]);
    const switches = await readFeatureSwitches(c.env, state.legacy, { fresh: true });
    const actorIds = [...switches.rows.values()].map((r) => r.updatedBy);
    const names = await resolveNames(c.env.SEARCH_DB as never, { profiles: actorIds });
    const ready: FeatureStateReport['ready'] = { ...state.ready, newsletter: newsletterReady };
    const pending = await pendingSwitchChanges(c.env.SEARCH_DB as never, async () => workflowSeesMoney(c, await workflowCtx(c.env as never).directory.actor(actorOf(c), roles(c) ?? [])));
    const items: FeatureItem[] = FEATURE_REGISTRY.map((def) => {
      const row = switches.rows.get(def.key);
      const isReady = ready[def.key] ?? true;
      return {
        key: def.key,
        enabled: switches.stored[def.key],
        effective: switches.effective[def.key],
        blockedBy: blockedBy(def.key, switches.stored),
        ready: isReady !== false,
        setupNote: isReady === false ? FEATURE_SETUP_NOTES[def.key] ?? null : null,
        envOverride: switches.forced.has(def.key),
        parked: 0,
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row ? { id: row.updatedBy, name: names.profiles.get(row.updatedBy) ?? null } : null,
        canToggle: canToggle(roles(c), def),
        pending: pending.get(def.key) ?? null,
      };
    });
    return c.json(
      {
        success: true,
        result: {
          items,
          canManage: hasPermission(roles(c), 'features:manage'),
          stateAvailable: available,
          propagationSeconds: FEATURE_PROPAGATION_SECONDS,
        },
      },
      200,
      { 'Cache-Control': 'private, no-store' },
    );
  });

  app.put('/:key', async (c) => {
    if (!hasPermission(roles(c), 'features:manage')) return forbidden(c, 'features:manage');
    const key = c.req.param('key');
    if (!isFeatureKey(key)) return apiError(c, 404, 'not_found', { error: 'Unknown feature' });
    const def = FEATURE_REGISTRY.find((d) => d.key === key)!;
    if (!canToggle(roles(c), def)) return forbidden(c, 'super_admin');
    const input = (await c.req.json().catch(() => ({}))) as { enabled?: unknown; expectedVersion?: unknown; undo?: unknown; reason?: unknown };
    if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
      return apiError(c, 400, 'invalid_request', { error: 'enabled (boolean) and expectedVersion (integer) are required' });
    }

    // The value in force before the first write: the old setting, else the default
    const rows = await readSwitchRows(c.env, { fresh: true });
    let currentStored = rows.get(key)?.enabled;
    if (currentStored === undefined) {
      const { state } = await readState(c);
      currentStored = state.legacy[key] ?? DEFAULT_FEATURE_SWITCHES[key];
    }

    if (input.enabled && !currentStored) {
      const check = await checkCanTurnOn(c.env, key, checks);
      if (check.ok === false) {
        const lang = errorLangOf(c.req.raw);
        logger.info('[Features] Turn on refused by its precondition', { key, actorId: actorOf(c) });
        return apiError(c, 409, 'feature_precondition', { message: check.reason[lang], lang, reason: check.reason, ...(check.reasonKey ? { reasonKey: check.reasonKey } : {}), feature: key });
      }
    }

    // Approval workflows (wiki AUN-WORKFLOWS WF-9): every switch is direct (creatorSupport too, owner
    // 2026-11-24; its readiness is the precondition above). A switch whose rule an admin gave approvers
    // becomes a change request and moves on approval
    if (c.env.SEARCH_DB) {
      const ctx = workflowCtx(c.env as never, { steppedUp: stepUpAnswer(c as never) === null });
      if (await ruleNeedsApproval(ctx, 'features.set', key)) {
        // A stale version is refused now, as a direct write would be, never as a request that can
        // only fail when it is approved
        const seen = rows.get(key)?.version ?? 0;
        if (seen !== input.expectedVersion) {
          return apiError(c, 409, 'feature_changed', { error: 'feature_changed', current: { enabled: currentStored, version: seen } });
        }
        try {
          const actor = await ctx.directory.actor(actorOf(c), roles(c) ?? []);
          const def = FEATURE_REGISTRY.find((d) => d.key === key)!;
          const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason : `${input.enabled ? 'Turn on' : 'Turn off'} ${def.name.en}`;
          const out = await proposeChange(ctx, actor, { type: 'features.set', payload: { key, enabled: input.enabled, expectedVersion: input.expectedVersion, currentStored }, reason });
          logger.info('[Features] Switch change sent for approval', { key, enabled: input.enabled, actorId: actorOf(c), status: out.status });
          return c.json({ success: true, result: out }, out.status === 'applied' ? 200 : 202);
        } catch (error) {
          if (error instanceof WorkflowError) return apiError(c, error.status, error.code, error.extra as never);
          throw error;
        }
      }
    }

    const db = c.env.REPORTS_DB;
    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(
        auditId,
        `feature:${key}`,
        JSON.stringify({ enabled: currentStored }),
        JSON.stringify({ action: 'feature.switch', details: { enabled: input.enabled, undo: input.undo === true } }),
        actorOf(c),
        now,
        auditOriginJson(),
      )
      .run();
    try {
      const result = await writeFeatureSwitch(c.env, {
        key,
        enabled: input.enabled,
        expectedVersion: input.expectedVersion,
        actorId: actorOf(c),
        undo: input.undo === true,
        currentStored,
        now,
      });
      logger.info('[Features] Switch changed', { key, previous: result.previous, enabled: result.enabled, version: result.version, actorId: actorOf(c), undo: input.undo === true });
      return c.json({ success: true, result: { previous: result.previous, enabled: result.enabled, version: result.version } });
    } catch (error) {
      await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(auditId).run().catch((e: unknown) =>
        logger.error('[Features] Could not drop the audit row of a failed change', { auditId, error: String(e) }));
      if (error instanceof SwitchWriteError) {
        return apiError(c, error.status, error.code, { error: error.code, ...(error.current ? { current: error.current } : {}) });
      }
      throw error;
    }
  });

  app.get('/:key/history', async (c) => {
    if (!hasPermission(roles(c), 'features:read')) return forbidden(c, 'features:read');
    const key = c.req.param('key');
    if (!isFeatureKey(key)) return apiError(c, 404, 'not_found', { error: 'Unknown feature' });
    const page = await readSwitchHistory(c.env, key, c.req.query('cursor'));
    const names = await resolveNames(c.env.SEARCH_DB as never, { profiles: page.items.map((i) => i.actorId) });
    return c.json({
      success: true,
      result: {
        items: page.items.map(({ actorId, ...rest }) => ({ ...rest, actor: { id: actorId, name: names.profiles.get(actorId) ?? null } })),
        nextCursor: page.nextCursor,
      },
    });
  });

  return app;
}

export default createFeaturesRouter();
