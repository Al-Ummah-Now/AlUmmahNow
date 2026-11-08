/**
 * Moderation config: env defaults + remote overrides in D1 `moderation_config`.
 *
 * Kill switch: AI runs only when BOTH the env var AI_MODERATION_ENABLED is not "false"
 * AND the D1 row `enabled` is "true". No D1 row means off, so a fresh environment
 * makes no AI calls until an Admin turns it on in admin-web.
 */
import type {
  AiModerationConfig,
  ModerationCategory,
  ModerationCategoryPolicy,
  D1Database,
} from '@al-ummah/shared-types';
import { AI_HIDEABLE_CATEGORIES } from '@al-ummah/shared-types';

export const PROMPT_VERSION = 'mod-v1';
export const DEFAULT_DAILY_NEURON_CAP = 10_000;

const flag = (threshold: number): ModerationCategoryPolicy => ({ mode: 'shadow', threshold, action: 'flag', enabled: true });

/** Seed policies (plan §3). Everything starts in shadow mode. */
export const DEFAULT_POLICIES: Record<ModerationCategory, ModerationCategoryPolicy> = {
  S1: flag(0.5), S2: flag(0.5), S3: flag(0.5), S4: flag(0.5), S5: flag(0.5), S6: flag(0.5), S7: flag(0.5),
  S8: flag(0.5), S9: flag(0.5), S10: flag(0.5), S11: flag(0.5), S12: flag(0.5), S13: flag(0.5), S14: flag(0.5),
  spam: { mode: 'shadow', threshold: 0.9, action: 'hide', enabled: true },
  charity_scam: { mode: 'shadow', threshold: 0.9, action: 'hide', enabled: true },
  sectarian_hate: flag(0.7),
  violent_extremism: flag(0.7),
  harassment: flag(0.7),
  impersonation: flag(0.7),
  sexual: flag(0.7),
  misinfo_health: flag(0.8),
  religious_authenticity: { mode: 'shadow', threshold: 0.8, action: 'flag', enabled: false },
};

export interface ModerationEnv {
  AI_MODERATION_ENABLED?: string | undefined;
  AI_MODERATION_DAILY_NEURON_CAP?: string | undefined;
  REPORTS_DB: D1Database;
}

function parseJson<T>(value: string | undefined): T | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Clamp a stored policy to what the engine allows (hide only for spam/scam). */
export function sanitizePolicy(category: string, policy: Partial<ModerationCategoryPolicy>, base: ModerationCategoryPolicy): ModerationCategoryPolicy {
  const threshold = typeof policy.threshold === 'number' && policy.threshold >= 0 && policy.threshold <= 1 ? policy.threshold : base.threshold;
  const mode = policy.mode === 'enforce' || policy.mode === 'shadow' ? policy.mode : base.mode;
  let action = policy.action === 'none' || policy.action === 'flag' || policy.action === 'hide' ? policy.action : base.action;
  if (action === 'hide' && !AI_HIDEABLE_CATEGORIES.includes(category as ModerationCategory)) action = 'flag';
  if (category === 'religious_authenticity' && action !== 'none') action = 'flag';
  const enabled = typeof policy.enabled === 'boolean' ? policy.enabled : base.enabled;
  return { mode, threshold, action, enabled };
}

export async function loadConfig(env: ModerationEnv): Promise<AiModerationConfig> {
  const rows = await env.REPORTS_DB.prepare('SELECT key, value FROM moderation_config').all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));

  const envOn = env.AI_MODERATION_ENABLED !== 'false';
  const remoteOn = parseJson<boolean>(map.get('enabled')) === true;

  const envCap = Number(env.AI_MODERATION_DAILY_NEURON_CAP);
  const remoteCap = parseJson<number>(map.get('daily_neuron_cap'));
  const dailyNeuronCap =
    typeof remoteCap === 'number' && remoteCap >= 0 ? remoteCap : Number.isFinite(envCap) && envCap >= 0 && env.AI_MODERATION_DAILY_NEURON_CAP ? envCap : DEFAULT_DAILY_NEURON_CAP;

  const overrides = parseJson<Record<string, Partial<ModerationCategoryPolicy>>>(map.get('policies')) ?? {};
  const policies = { ...DEFAULT_POLICIES };
  for (const [category, policy] of Object.entries(overrides)) {
    const base = DEFAULT_POLICIES[category as ModerationCategory];
    if (!base || !policy || typeof policy !== 'object') continue;
    policies[category as ModerationCategory] = sanitizePolicy(category, policy, base);
  }

  return {
    enabled: envOn && remoteOn,
    dailyNeuronCap,
    extensionsEnabled: parseJson<boolean>(map.get('extensions_enabled')) === true,
    policies,
  };
}
