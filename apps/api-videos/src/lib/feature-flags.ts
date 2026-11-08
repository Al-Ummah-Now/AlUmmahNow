/**
 * Remote config & feature flags (Epic 9.5), served in `/api/v1/app-config`.
 *
 * KV `APP_CONFIG` holds one JSON document per key:
 * - `flags`:  rules whose result is `flags[key]` (true/false, or `value`)
 * - `config`: rules whose result is `config[key]` (`value`)
 * - `versions`: update policies (lib/app-config.ts)
 *
 * Rules are evaluated in order and the first matching rule of a key decides
 * it, so a targeted rule placed before a general one overrides it. A flag no
 * rule matches is false (clients see every known flag); a config key no rule
 * matches is left out (clients use their built-in default).
 */
import { z } from 'zod';
import { APPS, PLATFORMS, SEMVER, compareVersions } from './app-config';
import type { AppName, Platform } from './app-config';
import { readAppConfigDocument } from './app-config-store';

const KEY = /^[a-z][a-z0-9_.-]{0,63}$/;

export const FlagRuleSchema = z
	.object({
		key: z.string().regex(KEY),
		enabled: z.boolean().default(true),
		platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
		apps: z.array(z.enum(APPS)).min(1).optional(),
		minVersion: z.string().regex(SEMVER).optional(),
		maxVersion: z.string().regex(SEMVER).optional(),
		/** Language prefixes: `ar` matches `ar`, `ar-EG`, ... */
		locales: z.array(z.string().min(2).max(16)).min(1).optional(),
		/** Percent of installs (0..100), stable per install id and key. */
		rollout: z.number().min(0).max(100).optional(),
		value: z.unknown().optional(),
		note: z.string().max(500).optional(),
	})
	.strict()
	.refine((r) => !r.minVersion || !r.maxVersion || compareVersions(r.minVersion, r.maxVersion) <= 0, {
		message: 'minVersion must not be greater than maxVersion',
	});
export type FlagRule = z.infer<typeof FlagRuleSchema>;

export const RulesDocumentSchema = z.array(FlagRuleSchema).max(500);
export const ConfigRulesDocumentSchema = z.array(
	FlagRuleSchema.refine((r) => r.value !== undefined, { message: 'config rules need a value' }),
).max(500);

export interface FlagContext {
	platform: Platform;
	app: AppName;
	version: string;
	locale?: string;
	installId?: string;
}

/** Stable 0..99 bucket for (key, install): FNV-1a, so it is synchronous and identical everywhere. */
export function rolloutBucket(key: string, installId: string): number {
	let h = 0x811c9dc5;
	const s = `${key}:${installId}`;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) % 100;
}

export function ruleMatches(rule: FlagRule, ctx: FlagContext): boolean {
	if (rule.platforms && !rule.platforms.includes(ctx.platform)) return false;
	if (rule.apps && !rule.apps.includes(ctx.app)) return false;
	if (rule.minVersion && compareVersions(ctx.version, rule.minVersion) < 0) return false;
	if (rule.maxVersion && compareVersions(ctx.version, rule.maxVersion) > 0) return false;
	if (rule.locales) {
		const locale = ctx.locale?.toLowerCase();
		if (!locale || !rule.locales.some((l) => locale === l.toLowerCase() || locale.startsWith(`${l.toLowerCase()}-`))) return false;
	}
	if (rule.rollout !== undefined && rule.rollout < 100) {
		// Partial rollouts need an install id; without one the install is outside
		if (!ctx.installId || rolloutBucket(rule.key, ctx.installId) >= rule.rollout) return false;
	}
	return true;
}

export function evaluateFlags(rules: FlagRule[], ctx: FlagContext): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const rule of rules) {
		if (rule.key in out) continue;
		if (ruleMatches(rule, ctx)) out[rule.key] = rule.enabled ? (rule.value ?? true) : false;
	}
	for (const rule of rules) if (!(rule.key in out)) out[rule.key] = false;
	return out;
}

export function evaluateConfig(rules: FlagRule[], ctx: FlagContext): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const rule of rules) {
		if (rule.key in out || !rule.enabled) continue;
		if (ruleMatches(rule, ctx)) out[rule.key] = rule.value;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Parsed rules; a missing or invalid document yields [] and the error (logged by the caller). */
export async function loadRules(kv: KVNamespace | undefined, key: 'flags' | 'config'): Promise<{ rules: FlagRule[]; error?: string }> {
	const raw = await readAppConfigDocument(kv, key);
	if (raw == null) return { rules: [] };
	const parsed = (key === 'config' ? ConfigRulesDocumentSchema : RulesDocumentSchema).safeParse(raw);
	return parsed.success ? { rules: parsed.data } : { rules: [], error: parsed.error.message };
}
