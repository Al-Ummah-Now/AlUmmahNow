/**
 * `features.set` on the approval workflow (wiki AUN-WORKFLOWS WF-9): every switch is direct by default,
 * creatorSupport included (owner 2026-11-24, WF-D9 superseded: switching a feature is not handling
 * money). A switch whose rule an admin gave approvers is a change request; the Features page answers
 * 202 and the switch moves only once it is approved. Direct switches keep the Features page's own
 * write (routers/features.router.ts).
 *
 * The apply step re-checks the switch's precondition (creatorSupport: the organization exists and a
 * finance approver does) and writes through the shared store with the request id as the change id, so a
 * retry after a crash never records the change twice.
 */
import { FEATURE_REGISTRY, isFeatureKey, isSuperAdmin, SwitchWriteError, writeFeatureSwitch, type FeatureKey } from '@al-ummah/shared-types';
import { checkCanTurnOn, type FeaturePrecondition } from '../feature-preconditions';
import { hasPermission } from '../roles';
import type { AdminBindings } from '../../base/types';
import type { D1Database } from '../types';
import { registerWorkflowExecutor, WorkflowError } from './engine';
import type { WorkflowExecutor } from './types';

export interface FeatureSetPayload {
  key: FeatureKey;
  enabled: boolean;
  /** The switch version the admin saw (0: never written) */
  expectedVersion: number;
  /** The value in force before the first write (old setting or default) */
  currentStored: boolean;
}

async function switchVersion(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare('SELECT version FROM feature_switches WHERE key = ?').bind(key).first<{ version: number }>();
  return row?.version ?? 0;
}

export function featureSetExecutor(checks: Partial<Record<FeatureKey, FeaturePrecondition>>): WorkflowExecutor<FeatureSetPayload, { enabled: boolean; version: number }> {
  return {
    type: 'features.set',
    scope: (p) => p.key,
    target: (p) => ({ kind: 'feature', id: p.key }),
    canPropose: async (_ctx, actor, p) => {
      const def = FEATURE_REGISTRY.find((d) => d.key === p.key);
      return !!def && hasPermission(actor.roles, 'features:manage') && (def.toggle !== 'superAdmin' || isSuperAdmin(actor.roles));
    },
    async validate(_ctx, input) {
      const i = (input ?? {}) as Partial<FeatureSetPayload>;
      if (!isFeatureKey(i.key) || typeof i.enabled !== 'boolean' || !Number.isInteger(i.expectedVersion) || (i.expectedVersion as number) < 0 || typeof i.currentStored !== 'boolean') {
        throw new WorkflowError(400, 'invalid_request');
      }
      return { key: i.key, enabled: i.enabled, expectedVersion: i.expectedVersion as number, currentStored: i.currentStored };
    },
    async describe(ctx, p) {
      const def = FEATURE_REGISTRY.find((d) => d.key === p.key)!;
      return {
        title: p.enabled ? { en: `Turn on ${def.name.en}`, ar: `تشغيل ${def.name.ar}` } : { en: `Turn off ${def.name.en}`, ar: `إيقاف ${def.name.ar}` },
        fields: [{ key: 'enabled', label: { en: def.name.en, ar: def.name.ar }, kind: 'bool', before: p.currentStored, after: p.enabled }],
        baseVersion: String(await switchVersion(ctx.db, p.key)),
      };
    },
    currentVersion: async (ctx, p) => String(await switchVersion(ctx.db, p.key)),
    async applyJob(ctx, p, request) {
      const env = ctx.env as AdminBindings;
      if (p.enabled && !p.currentStored) {
        const check = await checkCanTurnOn(env, p.key, checks);
        // A precondition that no longer holds fails the apply (Retry once it holds again)
        if (check.ok === false) throw new Error(`feature_precondition: ${check.reason.en}`);
      }
      try {
        const out = await writeFeatureSwitch(env as never, { key: p.key, enabled: p.enabled, expectedVersion: p.expectedVersion, actorId: request.proposedBy, currentStored: p.currentStored, id: request.id });
        return { enabled: out.enabled, version: out.version };
      } catch (error) {
        // Applied before a crash: the change row carries this request's id
        if (error instanceof SwitchWriteError && error.code === 'feature_changed') {
          const done = await ctx.db.prepare('SELECT version FROM feature_switch_changes WHERE id = ?').bind(request.id).first<{ version: number }>();
          if (done) return { enabled: p.enabled, version: done.version };
        }
        throw error;
      }
    },
  };
}

/** Registers (or replaces) the executor with these preconditions; the last caller wins. */
export function registerFeatureExecutor(checks: Partial<Record<FeatureKey, FeaturePrecondition>>): void {
  registerWorkflowExecutor(featureSetExecutor(checks));
}
