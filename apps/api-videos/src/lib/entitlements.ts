/**
 * Resolves a subject's entitlements (Epic 27) from D1, cached in KV for 60 s.
 *
 * Per-subject rows and the default plan are cached separately so admin-api can
 * invalidate exactly the subject it changed. Expiry is evaluated on every call,
 * so a cached override or trial still ends on time.
 *
 * Any D1 or KV failure resolves to the permissive catalogue fallbacks: an outage
 * must never lock creators out.
 */
import {
	UNLIMITED,
	resolveEntitlements,
	usagePeriod,
	type EntitlementOverride,
	type EntitlementValue,
	type ResolvedEntitlement,
	type Subject,
	type UpgradeRequiredError,
} from '@al-ummah/shared-types';
import { logger } from './logger';

export const ENTITLEMENT_CACHE_TTL_SECONDS = 60;
const KEY_PREFIX = 'entitlements:v1';
export const DEFAULT_PLAN_CACHE_KEY = `${KEY_PREFIX}:default`;
export const subjectCacheKey = (s: Subject) => `${KEY_PREFIX}:${s.type}:${s.id}`;

export interface EntitlementsEnv {
	REPORTS_DB?: any;
	RATE_LIMIT_KV?: any;
}

export interface PlanSummary {
	slug: string;
	name_en: string;
	name_ar: string;
}

interface CachedPlan {
	plan: PlanSummary;
	values: Record<string, EntitlementValue>;
}

interface CachedSubscription extends CachedPlan {
	status: string;
	current_period_end: string | null;
}

interface SubjectRows {
	overrides: EntitlementOverride[];
	subscription: CachedSubscription | null;
}

export interface EntitlementSnapshot {
	plan: PlanSummary | null;
	entitlements: Record<string, ResolvedEntitlement>;
	/** True when D1 could not be read and fallbacks were used. */
	degraded: boolean;
}

function rowsToPlan(rows: any[]): CachedPlan | null {
	if (rows.length === 0) return null;
	const values: Record<string, EntitlementValue> = {};
	for (const r of rows) if (r.key !== null && r.key !== undefined) values[r.key] = JSON.parse(r.value_json);
	return { plan: { slug: rows[0].slug, name_en: rows[0].name_en, name_ar: rows[0].name_ar }, values };
}

async function cached<T>(env: EntitlementsEnv, key: string, load: () => Promise<T>): Promise<T> {
	const kv = env.RATE_LIMIT_KV;
	if (kv) {
		try {
			const hit = await kv.get(key);
			if (hit) return JSON.parse(hit) as T;
		} catch (error) {
			logger.warn('[Entitlements] Cache read failed', { key, error: error instanceof Error ? error.message : String(error) });
		}
	}
	const value = await load();
	if (kv) {
		try {
			await kv.put(key, JSON.stringify(value), { expirationTtl: ENTITLEMENT_CACHE_TTL_SECONDS });
		} catch (error) {
			logger.warn('[Entitlements] Cache write failed', { key, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return value;
}

async function loadDefaultPlan(db: any): Promise<CachedPlan | null> {
	const { results } = await db
		.prepare(
			`SELECT p.slug, p.name_en, p.name_ar, e.key, e.value_json
			   FROM plans p
			   LEFT JOIN plan_entitlements e ON e.plan_id = p.id AND e.plan_version = p.version
			  WHERE p.is_default = 1`,
		)
		.all();
	return rowsToPlan(results);
}

async function loadSubjectRows(db: any, subject: Subject): Promise<SubjectRows> {
	const [overrides, subscription] = await Promise.all([
		db.prepare('SELECT key, value_json, expires_at FROM entitlement_overrides WHERE subject_type = ? AND subject_id = ?').bind(subject.type, subject.id).all(),
		db
			.prepare(
				`SELECT p.slug, p.name_en, p.name_ar, s.status, s.current_period_end, e.key, e.value_json
				   FROM subscriptions s
				   JOIN plans p ON p.id = s.plan_id
				   LEFT JOIN plan_entitlements e ON e.plan_id = s.plan_id AND e.plan_version = s.plan_version
				  WHERE s.subject_type = ? AND s.subject_id = ? AND s.status IN ('trialing', 'active', 'past_due')`,
			)
			.bind(subject.type, subject.id)
			.all(),
	]);
	const plan = rowsToPlan(subscription.results);
	return {
		overrides: overrides.results.map((r: any) => ({ key: r.key, value: JSON.parse(r.value_json), expires_at: r.expires_at })),
		subscription: plan ? { ...plan, status: subscription.results[0].status, current_period_end: subscription.results[0].current_period_end } : null,
	};
}

function isLive(sub: CachedSubscription, now: Date): boolean {
	if (sub.status !== 'trialing' || !sub.current_period_end) return true;
	return new Date(sub.current_period_end).getTime() > now.getTime();
}

/**
 * Resolves entitlements. `subjects` is in priority order, e.g. a channel then
 * its owner, so a user-level grant also covers that user's channels.
 */
export async function getEntitlements(env: EntitlementsEnv, subjects: readonly Subject[], now: Date = new Date()): Promise<EntitlementSnapshot> {
	const fallback = (): EntitlementSnapshot => ({
		plan: null,
		entitlements: resolveEntitlements({ overrides: [], subscription: null, defaultPlan: null, now }),
		degraded: true,
	});
	const db = env.REPORTS_DB;
	if (!db) {
		logger.warn('[Entitlements] REPORTS_DB is not bound; using fallbacks');
		return fallback();
	}
	try {
		const [defaultPlan, ...subjectRows] = await Promise.all([
			cached(env, DEFAULT_PLAN_CACHE_KEY, () => loadDefaultPlan(db)),
			...subjects.map((s) => cached(env, subjectCacheKey(s), () => loadSubjectRows(db, s))),
		]);
		const rows = subjectRows as SubjectRows[];
		const subscription = rows.map((r) => r.subscription).find((s): s is CachedSubscription => !!s && isLive(s, now)) ?? null;
		const plan = defaultPlan as CachedPlan | null;
		return {
			plan: subscription?.plan ?? plan?.plan ?? null,
			entitlements: resolveEntitlements({
				overrides: rows.flatMap((r) => r.overrides),
				subscription: subscription?.values ?? null,
				defaultPlan: plan?.values ?? null,
				now,
			}),
			degraded: false,
		};
	} catch (error) {
		logger.warn('[Entitlements] Resolution failed; using fallbacks', { error: error instanceof Error ? error.message : String(error) });
		return fallback();
	}
}

export interface UsageEntry {
	current: number;
	limit: number | typeof UNLIMITED;
	warning: boolean;
}

export const BYTES_PER_GB = 1_000_000_000;

/** Metered usage for a user. Failure reports zero: usage display must not break a page. */
export async function getUsage(env: EntitlementsEnv, userId: string, snapshot: EntitlementSnapshot, now: Date = new Date()): Promise<Record<string, UsageEntry>> {
	const read = async (key: string, period: string): Promise<number> => {
		if (!env.REPORTS_DB) return 0;
		try {
			const row = await env.REPORTS_DB.prepare("SELECT value FROM usage_counters WHERE subject_type = 'user' AND subject_id = ? AND key = ? AND period = ?").bind(userId, key, period).first();
			return Number(row?.value ?? 0);
		} catch (error) {
			logger.warn('[Entitlements] Usage read failed', { key, error: error instanceof Error ? error.message : String(error) });
			return 0;
		}
	};
	const entry = (key: string, current: number): UsageEntry => {
		const value = snapshot.entitlements[key]?.value;
		const limit = typeof value === 'number' ? value : UNLIMITED;
		return { current, limit, warning: limit !== UNLIMITED && current >= limit * 0.8 };
	};
	const [uploads, bytes] = await Promise.all([read('upload.monthlyUploads', usagePeriod(now)), read('storage.gb', 'all')]);
	return {
		'upload.monthlyUploads': entry('upload.monthlyUploads', uploads),
		'storage.gb': entry('storage.gb', Math.round((bytes / BYTES_PER_GB) * 100) / 100),
	};
}

const UPGRADE_MESSAGES = {
	en: 'Your plan does not include this. Limit reached: {key}.',
	ar: 'خطتك لا تشمل هذا. تم بلوغ الحد: {key}.',
};

/** Picks en or ar from Accept-Language; anything else is English. */
export function requestLanguage(acceptLanguage: string | null | undefined): 'en' | 'ar' {
	return (acceptLanguage ?? '').trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function upgradeRequiredBody(key: string, limit: UpgradeRequiredError['limit'], current: number | null, lang: 'en' | 'ar'): UpgradeRequiredError {
	return { success: false, error: 'upgrade_required', entitlement: key, limit, current, message: UPGRADE_MESSAGES[lang].replace('{key}', key) };
}
