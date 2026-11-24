/**
 * What must be true before `ageRules` may be turned on (wiki E20 §5.2). Each check fails closed with its own reason:
 * an answer that can't be had is a no.
 */
import { ACCOUNT_EVENTS_MAX_AGE_MS, lastAccountEventAt, readAgeRules, type FeatureText } from '@al-ummah/shared-types';
import { logger } from './logger';

export type AgeRulesCheckKey = 'birthDate' | 'numbers' | 'accountEvents';
export interface AgeRulesCheck {
  key: AgeRulesCheckKey;
  ok: boolean;
  reason: FeatureText;
  reasonKey: string;
}

export interface AgeRulesCheckEnv {
  SEARCH_DB?: unknown;
  Issuer?: string;
}

const DISCOVERY_TIMEOUT_MS = 3000;

/** Auth lists `age_band` in its public discovery document only while its birth_date setting is on. */
async function birthDateIsOn(env: AgeRulesCheckEnv, fetchImpl: typeof fetch): Promise<boolean> {
  if (!env.Issuer) return false;
  const url = new URL('/.well-known/openid-configuration', env.Issuer);
  const res = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
  if (!res.ok) return false;
  const body = (await res.json()) as { issuer?: unknown; claims_supported?: unknown };
  // Another server's document says nothing about ours
  if (typeof body.issuer !== 'string' || new URL(body.issuer).origin !== url.origin) return false;
  return Array.isArray(body.claims_supported) && body.claims_supported.includes('age_band');
}

async function accountEventsArrive(env: AgeRulesCheckEnv, now: number): Promise<boolean> {
  const at = await lastAccountEventAt(env);
  return at !== null && at <= now + 60_000 && now - at <= ACCOUNT_EVENTS_MAX_AGE_MS;
}

const REASONS: Record<AgeRulesCheckKey, { reasonKey: string; reason: FeatureText }> = {
  birthDate: {
    reasonKey: 'age_rules_birth_date_off',
    reason: { en: 'The date of birth isn’t on in accounts here, or accounts couldn’t be reached.', ar: 'تاريخ الميلاد غير مفعّل في الحسابات هنا، أو تعذّر الوصول إلى الحسابات.' },
  },
  numbers: {
    reasonKey: 'age_rules_numbers_missing',
    reason: { en: 'The ages on the Age rules page haven’t been saved.', ar: 'لم تُحفظ الأعمار في صفحة قواعد العمر.' },
  },
  accountEvents: {
    reasonKey: 'age_rules_account_events_missing',
    reason: { en: 'No account event has arrived from accounts in the last 48 hours.', ar: 'لم يصل أي حدث حساب من الحسابات في آخر ٤٨ ساعة.' },
  },
};

/** All three, in the order the page lists them. */
export async function ageRulesChecks(env: AgeRulesCheckEnv, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<AgeRulesCheck[]> {
  const run = async (key: AgeRulesCheckKey, check: () => Promise<boolean>): Promise<AgeRulesCheck> => {
    let ok = false;
    try {
      ok = await check();
    } catch (error) {
      logger.warn('[AgeRules] Check could not be made', { key, error: error instanceof Error ? error.message : String(error) });
    }
    return { key, ok, ...REASONS[key] };
  };
  return Promise.all([
    run('birthDate', () => birthDateIsOn(env, opts.fetchImpl ?? fetch)),
    run('numbers', async () => (await readAgeRules(env, { fresh: true })) !== null),
    run('accountEvents', () => accountEventsArrive(env, opts.now ?? Date.now())),
  ]);
}
