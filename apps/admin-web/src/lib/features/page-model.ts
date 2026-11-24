/**
 * The Features page's model, kept apart from React so grouping, search, notes, the confirm decision
 * and the two-admins conflict are tested without a browser (test/features-page.test.ts).
 * Wiki AUN-FEATURES §2.2 (dependencies) and §3 (the page).
 */
import { FEATURE_GROUPS, dependantsOf, featureDefinition, type FeatureDefinition, type FeatureGroup, type FeatureKey, type FeatureText } from '@al-ummah/shared-types';
import type { FeatureItem } from '@/lib/api/features';
import type { Locale } from '@/i18n/config';

export interface FeatureRow {
  item: FeatureItem;
  def: FeatureDefinition;
}

export interface FeatureGroupView {
  id: FeatureGroup;
  rows: FeatureRow[];
}

/** Folds case, Arabic letter variants and diacritics, so «أ» finds «ا» and "uploads" finds "Uploads". */
export function foldSearch(text: string): string {
  return text
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of the query is in the feature's name or help text, in the page's language. */
export function matchesSearch(def: FeatureDefinition, query: string, locale: Locale): boolean {
  const words = foldSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldSearch(`${def.name[locale]} ${def.help[locale]}`);
  return words.every((w) => haystack.includes(w));
}

/** The rows in registry order, grouped in FEATURE_GROUPS order; groups with nothing to show are left out. */
export function groupFeatures(items: readonly FeatureItem[], query = '', locale: Locale = 'en'): FeatureGroupView[] {
  const rows = items.map((item) => ({ item, def: featureDefinition(item.key) })).filter((r) => matchesSearch(r.def, query, locale));
  return FEATURE_GROUPS.map((id) => ({ id, rows: rows.filter((r) => r.def.group === id) })).filter((g) => g.rows.length > 0);
}

/** What the state reads in words next to the switch. `waiting`: switched on, but off while something it needs is off. */
export type SwitchWords = 'on' | 'off' | 'waiting' | 'envOff';

export function switchWords(item: FeatureItem): SwitchWords {
  if (item.envOverride) return 'envOff';
  if (!item.enabled) return 'off';
  return item.blockedBy.length > 0 ? 'waiting' : 'on';
}

export type FeatureNote =
  | { kind: 'blocked'; by: FeatureKey[] }
  | { kind: 'needsSetup'; note: string | null; href: string | null }
  | { kind: 'envOverride' }
  | { kind: 'parked'; count: number };

/** The notes under a row's help text, most important first (wiki §3). */
export function featureNotes(item: FeatureItem, locale: Locale): FeatureNote[] {
  const def = featureDefinition(item.key);
  const notes: FeatureNote[] = [];
  if (item.envOverride) notes.push({ kind: 'envOverride' });
  if (item.blockedBy.length > 0) notes.push({ kind: 'blocked', by: [...item.blockedBy] });
  if (item.enabled && !item.ready && !item.envOverride) notes.push({ kind: 'needsSetup', note: item.setupNote?.[locale] ?? null, href: def.setupHref ?? null });
  if (item.parked > 0) notes.push({ kind: 'parked', count: item.parked });
  return notes;
}

/** Whether switching to `next` asks first (the entry's `confirm`), or acts at once with Undo. */
export function needsConfirm(def: Pick<FeatureDefinition, 'confirm'>, next: boolean): boolean {
  switch (def.confirm) {
    case 'both':
      return true;
    case 'off':
      return !next;
    case 'on':
      return next;
    default:
      return false;
  }
}

export interface ConfirmContent {
  key: FeatureKey;
  next: boolean;
  /** Features that go dark with this one (switching off only) */
  dependants: FeatureKey[];
  /** The owner's 2026-11-22 decision on caption downloads, said in the dialog */
  ownerDecision: boolean;
}

export function confirmContent(key: FeatureKey, next: boolean): ConfirmContent {
  return { key, next, dependants: next ? [] : dependantsOf(key), ownerDecision: key === 'viewerCaptionDownload' };
}

/** Why a row can't be switched by this admin, or null when it can. */
export type LockReason = 'envOverride' | 'superAdminOnly' | 'readOnly' | null;

export function lockReason(item: FeatureItem, canManage: boolean): LockReason {
  if (item.canToggle) return null;
  if (item.envOverride) return 'envOverride';
  if (canManage && featureDefinition(item.key).toggle === 'superAdmin') return 'superAdminOnly';
  return 'readOnly';
}

/**
 * A row after a refused write (409 feature_changed): admin-api sends the stored value and version now
 * (not who changed it), so the switch shows the real value at once and the page then reloads the
 * rows for the rest. Without `current` nothing changes here and the reload does it all.
 */
export function applyConflict(items: readonly FeatureItem[], key: FeatureKey, current: { enabled: boolean; version: number } | null): FeatureItem[] {
  if (!current) return [...items];
  return applyWrite(items, key, current.enabled, current.version, null, null);
}

/** A successful write applied to the list (Undo included). */
export function applyWrite(items: readonly FeatureItem[], key: FeatureKey, enabled: boolean, version: number, by: { id: string; name: string | null } | null, at: string | null): FeatureItem[] {
  const stored = Object.fromEntries(items.map((i) => [i.key, i.key === key ? enabled : i.enabled])) as Record<FeatureKey, boolean>;
  return items.map((i) => {
    const blocked = featureDefinition(i.key).requires.filter((r) => !effectiveOf(r, stored));
    const next = i.key === key ? { ...i, enabled, version, updatedAt: at ?? i.updatedAt, updatedBy: by ?? i.updatedBy } : i;
    return { ...next, blockedBy: blocked, effective: next.enabled && blocked.length === 0 && !next.envOverride };
  });
}

function effectiveOf(key: FeatureKey, stored: Record<FeatureKey, boolean>, seen = new Set<FeatureKey>()): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return Boolean(stored[key]) && featureDefinition(key).requires.every((r) => effectiveOf(r, stored, seen));
}

/** Header summary: how many are off for people right now. */
export function offCount(items: readonly FeatureItem[]): number {
  return items.filter((i) => !i.effective).length;
}

/**
 * A 409 feature_precondition body: the check's reason in both languages (the owning epic words it,
 * wiki AUN-FEATURES §5.3) and its stable code. The server's bare `message` is never shown, so the
 * page can't end up with one language inside the other.
 */
export function preconditionOf(body: Record<string, unknown> | undefined): { reason: FeatureText | null; reasonKey: string | null } {
  const r = body?.reason as Partial<FeatureText> | undefined;
  const reason = r && typeof r.en === 'string' && r.en.trim() && typeof r.ar === 'string' && r.ar.trim() ? { en: r.en, ar: r.ar } : null;
  return { reason, reasonKey: typeof body?.reasonKey === 'string' && body.reasonKey ? body.reasonKey : null };
}

/** The sentence under the switch, in the page's language; `fallback` (a message key's text) when no reason came. */
export function preconditionText(reason: FeatureText | null, locale: Locale, fallback: string): string {
  return reason?.[locale]?.trim() || fallback;
}
