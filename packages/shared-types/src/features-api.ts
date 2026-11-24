/**
 * The Features page's view of admin-api /api/features (wiki AUN-FEATURES §3–§5): the row and history
 * shapes, and the readers that turn admin-api's answers into them. admin-web reads every answer through
 * these, and admin-api's own tests feed its real router's answers through them
 * (apps/admin-api/test/features-api-contract.test.ts), so a change to one side fails a test.
 *
 * Every answer is the envelope `{ success: true, result }`; refusals are
 * `{ success: false, code, message, ... }` (api-error.ts).
 */
import type { FeatureKey, FeatureText } from './feature-registry';
import type { SwitchChange } from './feature-switch-store';

export interface FeatureActor {
  id: string;
  /** null when the account has no name to show (the page then says "an admin") */
  name: string | null;
}

/** One row of GET /api/features, in registry order. */
export interface FeatureItem {
  key: FeatureKey;
  /** The stored switch */
  enabled: boolean;
  /** On for people: stored, and every feature it requires is on, and no environment override */
  effective: boolean;
  /** The required features that are off (wiki §2.2) */
  blockedBy: FeatureKey[];
  /** Set up enough to work (keys, clients); false shows "needs setup" while on */
  ready: boolean;
  /** What is missing, in both languages, when not ready */
  setupNote: FeatureText | null;
  /** Off in this environment by an operations override (AI_CATEGORIZE_ENABLED=false): locked */
  envOverride: boolean;
  /** Background jobs waiting for it to come back on */
  parked: number;
  /** Bumped by every write; a write sends the version it saw */
  version: number;
  updatedAt: string | null;
  updatedBy: FeatureActor | null;
  /** This admin may change it (features:manage, and a super admin for super-admin-only rows) */
  canToggle: boolean;
  /** A change waiting for approval (wiki AUN-WORKFLOWS WF-9): the switch moves once it is approved */
  pending?: { requestId: string; enabled: boolean } | null;
}

export interface FeatureHistoryEntry {
  id: string;
  /** null: the first change from the default */
  oldEnabled: boolean | null;
  newEnabled: boolean;
  actor: FeatureActor;
  source: SwitchChange['source'];
  createdAt: string;
}

export interface FeatureHistoryPage {
  entries: FeatureHistoryEntry[];
  nextCursor: string | null;
}

export interface FeatureWrite {
  previous: boolean;
  enabled: boolean;
  version: number;
}

/**
 * The outcome of PUT /api/features/:key. `pending`: the switch's approval rule asks for approvers,
 * so the change is a request (202) and nothing moved yet. `changed`: someone else changed it first
 * (409 feature_changed), with the stored value and version now. `precondition`: it can't be switched
 * on yet (409 feature_precondition), with the check's reason in both languages and its code.
 */
export type FeatureWriteOutcome =
  | { ok: true; data: FeatureWrite }
  | { ok: false; kind: 'pending'; requestId: string; enabled: boolean }
  | { ok: false; kind: 'changed'; current: { enabled: boolean; version: number } | null }
  | { ok: false; kind: 'precondition'; reason: FeatureText | null; reasonKey: string | null };

type Body = Record<string, unknown> | null | undefined;

function resultOf(body: Body): Record<string, unknown> {
  const r = body?.result;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
}

const textOf = (v: unknown): FeatureText | null => {
  const t = v as Partial<FeatureText> | null | undefined;
  return t && typeof t.en === 'string' && t.en.trim() && typeof t.ar === 'string' && t.ar.trim() ? { en: t.en, ar: t.ar } : null;
};

/** GET /api/features → its rows. */
export function readFeatureList(body: Body): FeatureItem[] {
  const items = resultOf(body).items;
  return Array.isArray(items) ? (items as FeatureItem[]) : [];
}

/** GET /api/features/:key/history → one page. */
export function readFeatureHistory(body: Body): FeatureHistoryPage {
  const r = resultOf(body);
  const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
  return {
    entries: items.map((i) => {
      const actor = (i.actor ?? {}) as Partial<FeatureActor>;
      return {
        id: String(i.id),
        oldEnabled: typeof i.oldEnabled === 'boolean' ? i.oldEnabled : null,
        newEnabled: i.newEnabled === true,
        actor: { id: typeof actor.id === 'string' ? actor.id : '', name: typeof actor.name === 'string' && actor.name.trim() ? actor.name : null },
        source: i.source as SwitchChange['source'],
        createdAt: String(i.createdAt),
      };
    }),
    nextCursor: typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null,
  };
}

/**
 * A successful PUT answer (200 or 202). `sent` is what was asked for: a change the approval workflow
 * applied at once (200 with the request, status `applied`) moved the switch to it, one version on.
 */
export function readFeatureWrite(body: Body, sent: { enabled: boolean; expectedVersion: number }): FeatureWriteOutcome {
  const r = resultOf(body);
  if (r.status === 'pending_approval' || r.status === 'applied') {
    const request = (r.request ?? {}) as { id?: unknown };
    if (r.status === 'pending_approval') return { ok: false, kind: 'pending', requestId: typeof request.id === 'string' ? request.id : '', enabled: sent.enabled };
    return { ok: true, data: { previous: !sent.enabled, enabled: sent.enabled, version: sent.expectedVersion + 1 } };
  }
  return { ok: true, data: { previous: r.previous === true, enabled: r.enabled === true, version: Number(r.version) } };
}

/** A refused PUT: the two refusals the page explains itself, else null (the page shows the server's message). */
export function readFeatureRefusal(status: number, body: Body): Extract<FeatureWriteOutcome, { kind: 'changed' | 'precondition' }> | null {
  if (status !== 409) return null;
  if (body?.code === 'feature_changed') {
    const c = body.current as { enabled?: unknown; version?: unknown } | undefined;
    return { ok: false, kind: 'changed', current: c && typeof c.enabled === 'boolean' && Number.isInteger(c.version) ? { enabled: c.enabled, version: c.version as number } : null };
  }
  if (body?.code === 'feature_precondition') {
    return { ok: false, kind: 'precondition', reason: textOf(body.reason), reasonKey: typeof body.reasonKey === 'string' && body.reasonKey ? body.reasonKey : null };
  }
  return null;
}
