/**
 * Translation store overrides (#982).
 *
 * An environment's translation store (global_settings R2
 * `translations/{en,ar}.json`) holds a full copy of the strings, but only the
 * keys an admin edited are meant to win over the repo's static translations.
 * Each stored locale file lists those keys in `overrides` (dotted leaf paths,
 * e.g. `a11y.goToHomePage`). Every other key comes from the repo, so a string
 * changed in the repo reaches every environment on its next deploy.
 *
 * A file without `overrides` predates the list ("legacy"): every key whose
 * stored value differs from the repo counts as an override, which is how the
 * store behaved before the list existed.
 */

type Tree = Record<string, unknown>;

function isTree(value: unknown): value is Tree {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Leaf paths (`section.key`) to values. Arrays are leaves. */
export function flattenTranslations(tree: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isTree(tree)) return out;
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTree(value)) flattenTranslations(value, path, out);
    else out[path] = value;
  }
  return out;
}

const MISSING = Symbol('missing');

function getPath(tree: unknown, path: string): unknown {
  let node: unknown = tree;
  for (const segment of path.split('.')) {
    if (!isTree(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return MISSING;
    node = node[segment];
  }
  return node;
}

function setPath(tree: Tree, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = tree;
  for (const segment of segments.slice(0, -1)) {
    if (!isTree(node[segment])) node[segment] = {};
    // Copy on write: the defaults passed in are shared module objects
    node[segment] = { ...(node[segment] as Tree) };
    node = node[segment] as Tree;
  }
  node[segments[segments.length - 1]] = value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The stored file's override list, or null for a legacy file without one. */
export function storedOverrides(data: unknown): string[] | null {
  const overrides = isTree(data) ? data.overrides : undefined;
  return Array.isArray(overrides) ? overrides.filter((p): p is string => typeof p === 'string') : null;
}

/** Leaf paths whose stored value differs from the defaults (including keys the defaults lack). */
export function differingTranslationPaths(defaults: unknown, stored: unknown): string[] {
  const repo = flattenTranslations(defaults);
  return Object.entries(flattenTranslations(stored))
    .filter(([path, value]) => !Object.prototype.hasOwnProperty.call(repo, path) || !sameValue(value, repo[path]))
    .map(([path]) => path);
}

/**
 * The override list of a stored file: its `overrides`, or for a legacy file
 * every key that differs from the defaults.
 */
export function effectiveOverrides(defaults: unknown, data: unknown): string[] {
  return storedOverrides(data) ?? differingTranslationPaths(defaults, isTree(data) ? data.translations : undefined);
}

/**
 * The translations users see: the defaults (the repo's static translations),
 * with each override key taken from the stored translations. Override keys
 * the stored copy lacks keep the default.
 */
export function applyTranslationOverrides<T>(defaults: T, stored: unknown, overrides: readonly string[]): T {
  const result = { ...(defaults as unknown as Tree) };
  for (const path of overrides) {
    const value = getPath(stored, path);
    if (value !== MISSING && !isTree(value)) setPath(result, path, value);
  }
  return result as unknown as T;
}

/**
 * The override list after an admin saves `written` (a partial tree): each
 * written key joins the list, unless its new value equals the default, which
 * puts the key back under the repo's control.
 */
export function nextTranslationOverrides(previous: readonly string[], written: unknown, defaults: unknown): string[] {
  const repo = flattenTranslations(defaults);
  const next = new Set(previous);
  for (const [path, value] of Object.entries(flattenTranslations(written))) {
    if (Object.prototype.hasOwnProperty.call(repo, path) && sameValue(value, repo[path])) next.delete(path);
    else next.add(path);
  }
  return [...next].sort();
}
