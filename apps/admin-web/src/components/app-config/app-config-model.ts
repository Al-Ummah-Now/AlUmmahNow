/**
 * The remote config editor's rules (issue #413), free of React so they are unit tested
 * (test/app-config.test.ts): a stored document as editable drafts and back, the same checks
 * api-videos runs before it stores a document (so the admin sees each problem next to its field
 * before saving), the order of rules (the first match decides a key), and api-videos' own
 * problems placed on the rule and field they name.
 */
import { APP_CONFIG_APPS, APP_CONFIG_MAX_RULES, APP_CONFIG_PLATFORMS, APP_CONFIG_RULE_KEY, APP_CONFIG_SEMVER, compareAppVersionCores, compareAppVersions, isAppConfigApp, parseDigits, type AppConfigRule, type AppConfigVersionPolicy, type AppConfigVersionsDocument } from '@al-ummah/shared-types';

export type RulesKind = 'flags' | 'config';

/** One rule as the form edits it: lists as checkboxes, the rest as text. */
export interface RuleDraft {
  /** Local id, for React keys and problems; never stored */
  id: string;
  key: string;
  enabled: boolean;
  platforms: string[];
  apps: string[];
  minVersion: string;
  maxVersion: string;
  /** Comma-separated language prefixes (ar, en-GB) */
  locales: string;
  /** Percent of installs; empty for everyone */
  rollout: string;
  /** JSON text: true, 3, "1080p", {"a":1}; empty for none */
  value: string;
  note: string;
}

/** One `versions` entry: an app, a platform (or every platform of it) and its update policy. */
export interface VersionDraft {
  id: string;
  app: string;
  /** A platform, or `*` for every platform of the app */
  platform: string;
  minimumVersion: string;
  latestVersion: string;
  storeUrl: string;
  /** '' for every channel, 'beta' for TestFlight, Play testing and preview builds (`<app>/<platform>#beta`) */
  channel: '' | 'beta';
  /** The forced-screen message (both languages or neither) */
  messageEn: string;
  messageAr: string;
  /** Release notes for one version only */
  notesOverrides: NotesOverrideDraft[];
}

export interface NotesOverrideDraft {
  id: string;
  version: string;
  en: string;
  ar: string;
}

/** Why a field cannot be saved; the editor shows `appConfig.problems.<code>` next to it. */
export type ProblemCode =
  | 'keyRequired'
  | 'keyFormat'
  | 'versionFormat'
  | 'versionOrder'
  | 'rolloutRange'
  | 'valueJson'
  | 'valueRequired'
  | 'localeFormat'
  | 'urlFormat'
  | 'duplicateTarget'
  | 'tooMany'
  | 'tooManyNotes'
  | 'bothLanguages'
  | 'textTooLong'
  /** api-videos refused it; `detail` holds its words */
  | 'server';

export interface Problem {
  /** The draft it belongs to ('' for the whole document) */
  id: string;
  field: string;
  code: ProblemCode;
  detail?: string;
}

let seq = 0;
/** A fresh local id. */
export const draftId = (prefix: string) => `${prefix}-${++seq}`;

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A stored rule as a draft. */
export function ruleToDraft(rule: AppConfigRule): RuleDraft {
  return {
    id: draftId('rule'),
    key: rule.key ?? '',
    enabled: rule.enabled !== false,
    platforms: [...(rule.platforms ?? [])],
    apps: [...(rule.apps ?? [])],
    minVersion: rule.minVersion ?? '',
    maxVersion: rule.maxVersion ?? '',
    locales: (rule.locales ?? []).join(', '),
    rollout: rule.rollout === undefined ? '' : String(rule.rollout),
    value: rule.value === undefined ? '' : JSON.stringify(rule.value),
    note: rule.note ?? '',
  };
}

/** A new, empty rule (enabled, for everyone). Config rules start with a value to fill in. */
export function newRule(kind: RulesKind): RuleDraft {
  return { ...ruleToDraft({ key: '' }), value: kind === 'config' ? '""' : '' };
}

/**
 * A stored `rules` document as drafts; anything that is not a list starts empty. Apps we no longer have
 * are ignored, as api-videos ignores them; a rule for those apps only is left out, because with no app
 * ticked it would be for every app.
 */
export function rulesToDrafts(value: unknown): RuleDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is AppConfigRule => !!r && typeof r === 'object')
    .filter((r) => !r.apps?.length || r.apps.some(isAppConfigApp))
    .map((r) => ruleToDraft(r.apps ? { ...r, apps: r.apps.filter(isAppConfigApp) } : r));
}

/** The locales typed as a list (commas or spaces between them). */
export const splitLocales = (text: string) => text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);

/** One draft as the stored rule, or its problems. Empty optional fields are left out. */
export function draftToRule(d: RuleDraft, kind: RulesKind): { rule: AppConfigRule | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const add = (field: string, code: ProblemCode) => problems.push({ id: d.id, field, code });
  const key = d.key.trim();
  if (!key) add('key', 'keyRequired');
  else if (!APP_CONFIG_RULE_KEY.test(key)) add('key', 'keyFormat');
  const min = d.minVersion.trim();
  const max = d.maxVersion.trim();
  if (min && !APP_CONFIG_SEMVER.test(min)) add('minVersion', 'versionFormat');
  if (max && !APP_CONFIG_SEMVER.test(max)) add('maxVersion', 'versionFormat');
  if (min && max && APP_CONFIG_SEMVER.test(min) && APP_CONFIG_SEMVER.test(max) && compareAppVersionCores(min, max) > 0) add('maxVersion', 'versionOrder');
  const locales = splitLocales(d.locales);
  if (locales.some((l) => !LOCALE.test(l) || l.length > 16)) add('locales', 'localeFormat');
  const rolloutText = d.rollout.trim();
  const rollout = rolloutText === '' ? undefined : Number(parseDigits(rolloutText));
  if (rollout !== undefined && (!Number.isFinite(rollout) || rollout < 0 || rollout > 100)) add('rollout', 'rolloutRange');
  let value: unknown;
  const valueText = d.value.trim();
  if (valueText) {
    try {
      value = JSON.parse(valueText);
    } catch {
      add('value', 'valueJson');
    }
  } else if (kind === 'config') add('value', 'valueRequired');
  if (problems.length) return { rule: null, problems };

  const rule: AppConfigRule = { key, enabled: d.enabled };
  const platforms = APP_CONFIG_PLATFORMS.filter((p) => d.platforms.includes(p));
  const apps = APP_CONFIG_APPS.filter((a) => d.apps.includes(a));
  if (platforms.length) rule.platforms = platforms;
  if (apps.length) rule.apps = apps;
  if (min) rule.minVersion = min;
  if (max) rule.maxVersion = max;
  if (locales.length) rule.locales = locales;
  if (rollout !== undefined) rule.rollout = rollout;
  if (valueText) rule.value = value;
  if (d.note.trim()) rule.note = d.note.trim();
  return { rule, problems };
}

/** The drafts as the document to store, or every problem (nothing is sent while there are any). */
export function draftsToDocument(drafts: RuleDraft[], kind: RulesKind): { value: AppConfigRule[] | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const rules: AppConfigRule[] = [];
  if (drafts.length > APP_CONFIG_MAX_RULES) problems.push({ id: '', field: '', code: 'tooMany' });
  for (const d of drafts) {
    const r = draftToRule(d, kind);
    problems.push(...r.problems);
    if (r.rule) rules.push(r.rule);
  }
  return problems.length ? { value: null, problems } : { value: rules, problems };
}

/** Moves one item up (-1) or down (+1); the list as it was at either end. */
export function moveItem<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

/** The stored `versions` document as drafts, in its own order. Entries of apps we no longer have are left out. */
export function versionsToDrafts(value: unknown): VersionDraft[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, AppConfigVersionPolicy>).flatMap(([target, policy]) => {
    const [app = '', rest = ''] = target.split('/');
    if (!isAppConfigApp(app)) return [];
    const [platform = '', channel = ''] = rest.split('#');
    return [{
      id: draftId('ver'),
      app,
      platform,
      channel: channel === 'beta' ? 'beta' : '',
      minimumVersion: policy?.minimumVersion ?? '',
      latestVersion: policy?.latestVersion ?? '',
      storeUrl: policy?.storeUrl ?? '',
      messageEn: policy?.message?.en ?? '',
      messageAr: policy?.message?.ar ?? '',
      notesOverrides: Object.entries(policy?.notesOverrides ?? {}).map(([version, n]) => ({ id: draftId('notes'), version, en: n?.en ?? '', ar: n?.ar ?? '' })),
    }];
  });
}

export const newVersion = (): VersionDraft => ({ id: draftId('ver'), app: 'viewer', platform: '*', channel: '', minimumVersion: '', latestVersion: '', storeUrl: '', messageEn: '', messageAr: '', notesOverrides: [] });

export const newNotesOverride = (): NotesOverrideDraft => ({ id: draftId('notes'), version: '', en: '', ar: '' });

/** Release notes and messages are at most this long, as the server requires */
export const APP_TEXT_MAX = 1500;
/** Notes overrides per entry */
export const NOTES_OVERRIDES_MAX = 5;

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:' && text.startsWith('https://');
  } catch {
    return false;
  }
}

/** The drafts as the `versions` document, or every problem. Two entries for one app and platform are refused. */
export function versionsToDocument(drafts: VersionDraft[]): { value: AppConfigVersionsDocument | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const doc: AppConfigVersionsDocument = {};
  const seen = new Set<string>();
  for (const d of drafts) {
    const add = (field: string, code: ProblemCode) => problems.push({ id: d.id, field, code });
    const target = `${d.app}/${d.platform}${d.channel === 'beta' ? '#beta' : ''}`;
    if (seen.has(target)) add('platform', 'duplicateTarget');
    seen.add(target);
    const min = d.minimumVersion.trim();
    const latest = d.latestVersion.trim();
    const url = d.storeUrl.trim();
    if (!APP_CONFIG_SEMVER.test(min)) add('minimumVersion', 'versionFormat');
    if (latest && !APP_CONFIG_SEMVER.test(latest)) add('latestVersion', 'versionFormat');
    else if (latest && APP_CONFIG_SEMVER.test(min) && compareAppVersions(latest, min) < 0) add('latestVersion', 'versionOrder');
    if (url && !isHttpsUrl(url)) add('storeUrl', 'urlFormat');
    const policy: AppConfigVersionPolicy = { minimumVersion: min };
    if (latest) policy.latestVersion = latest;
    if (url) policy.storeUrl = url;
    // The forced-screen message: both languages or neither (localized fields rule)
    const en = d.messageEn.trim();
    const ar = d.messageAr.trim();
    if (!!en !== !!ar) add(en ? 'messageAr' : 'messageEn', 'bothLanguages');
    if (en.length > APP_TEXT_MAX) add('messageEn', 'textTooLong');
    if (ar.length > APP_TEXT_MAX) add('messageAr', 'textTooLong');
    if (en && ar) policy.message = { en, ar };
    if (d.notesOverrides.length > NOTES_OVERRIDES_MAX) add('notesOverrides', 'tooManyNotes');
    const overrides: Record<string, { en: string; ar: string }> = {};
    for (const o of d.notesOverrides) {
      const v = o.version.trim();
      const oe = o.en.trim();
      const oa = o.ar.trim();
      if (!APP_CONFIG_SEMVER.test(v)) add(`notes.${o.id}.version`, 'versionFormat');
      else if (v in overrides) add(`notes.${o.id}.version`, 'duplicateTarget');
      if (!oe || !oa) add(`notes.${o.id}.${oe ? 'ar' : 'en'}`, 'bothLanguages');
      if (oe.length > APP_TEXT_MAX) add(`notes.${o.id}.en`, 'textTooLong');
      if (oa.length > APP_TEXT_MAX) add(`notes.${o.id}.ar`, 'textTooLong');
      if (v && oe && oa) overrides[v] = { en: oe, ar: oa };
    }
    if (Object.keys(overrides).length) policy.notesOverrides = overrides;
    doc[target] = policy;
  }
  return problems.length ? { value: null, problems } : { value: doc, problems };
}

// ---------------------------------------------------------------------------
// api-videos' problems
// ---------------------------------------------------------------------------

/**
 * Problems api-videos sent back (`problem` is the path: `0.key` for the first rule's key,
 * `viewer/ios.minimumVersion` for a versions entry), placed on the draft they name. One it cannot
 * place belongs to the whole document.
 */
export function serverProblems(problems: { problem: string; detail?: string }[] | undefined, drafts: { id: string }[], kind: RulesKind | 'versions', versionDrafts: VersionDraft[] = []): Problem[] {
  return (problems ?? []).map(({ problem, detail }) => {
    const [head, field = ''] = problem.split(/\.(.*)/s);
    if (kind === 'versions') {
      const d = versionDrafts.find((v) => `${v.app}/${v.platform}${v.channel === 'beta' ? '#beta' : ''}` === head);
      return { id: d?.id ?? '', field: d ? field : '', code: 'server' as const, detail };
    }
    const index = /^\d+$/.test(head) ? Number(head) : -1;
    const d = index >= 0 ? drafts[index] : undefined;
    return { id: d?.id ?? '', field: d ? field.split('.')[0] : '', code: 'server' as const, detail };
  });
}

/** The problems of one draft and field. */
export const problemsFor = (problems: Problem[], id: string, field: string) => problems.filter((p) => p.id === id && p.field === field);

/** A one-line summary of where a rule applies, from its draft (shown on a folded rule). */
export function ruleScope(d: RuleDraft): { platforms: string[]; apps: string[]; versions: string | null; locales: string[]; rollout: string | null } {
  const min = d.minVersion.trim();
  const max = d.maxVersion.trim();
  return {
    platforms: d.platforms,
    apps: d.apps,
    versions: min && max ? `${min} – ${max}` : min ? `≥ ${min}` : max ? `≤ ${max}` : null,
    locales: splitLocales(d.locales),
    rollout: d.rollout.trim() ? `${d.rollout.trim()}%` : null,
  };
}
