// Contrast for one colour slot, so each field can show its WCAG AA result as it is edited.
import { AA_NON_TEXT, AA_TEXT, BASE, contrastRatio, get, resolvedColors, type Issue, type Mode, type ThemePackage } from '@al-ummah/theme-packages';

export interface ContrastCheck { against: string; ratio: number; min: number }

/** The pairs a colour role takes part in, worst first. */
export function roleContrast(theme: ThemePackage, mode: Mode, role: string): ContrastCheck[] {
  let colors;
  try { colors = resolvedColors(theme)[mode].roles; } catch { return []; }
  const meta = BASE.roles.find((r) => r.name === role);
  if (!meta) return [];
  const surfaces = BASE.roles.filter((r) => r.role === 'surface').map((r) => r.name as string);
  const pairs: [string, string, number][] = [];
  if (meta.role === 'text') surfaces.forEach((s) => pairs.push([role, s, AA_TEXT]));
  if (meta.role === 'nontext') surfaces.forEach((s) => pairs.push([role, s, AA_NON_TEXT]));
  if (meta.role === 'on' && 'on' in meta) pairs.push([role, meta.on as string, AA_TEXT]);
  if (meta.role === 'surface') BASE.roles.filter((r) => r.role === 'text').forEach((t) => pairs.push([t.name, role, AA_TEXT]));
  if (meta.role === 'fill') BASE.roles.filter((r) => r.role === 'on' && 'on' in r && r.on === role).forEach((t) => pairs.push([t.name, role, AA_TEXT]));
  return pairs
    .map(([fg, bg, min]) => ({ against: fg === role ? bg : fg, ratio: contrastRatio(colors[fg], colors[bg]), min }))
    .sort((a, b) => a.ratio / a.min - b.ratio / b.min);
}

/** The pairs a component colour part takes part in, worst first. */
export function partContrast(theme: ThemePackage, mode: Mode, part: string): ContrastCheck[] {
  let parts;
  try { parts = resolvedColors(theme)[mode].parts; } catch { return []; }
  return BASE.componentPairs
    .filter(([fg, bg]) => fg === part || bg === part)
    .map(([fg, bg, min]) => ({ against: fg === part ? bg : fg, ratio: contrastRatio(parts[fg], parts[bg]), min }))
    .sort((a, b) => a.ratio / a.min - b.ratio / b.min);
}

/**
 * Each issue at a colour slot, also filed under every role and brand colour that slot reaches
 * through {color.*} and {brand.*}, so a failing pair shows next to the colour that causes it
 * (a role or brand swatch edit can break a component pair several references away).
 */
export function traceIssues(theme: ThemePackage, issues: Issue[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (path: string, message: string) => {
    const list = out.get(path) ?? [];
    if (!list.includes(message)) list.push(message);
    out.set(path, list);
  };
  for (const issue of issues) {
    add(issue.path, issue.message);
    const m = /^(tokens\.color|components\.[a-zA-Z]+\.colors)\.(light|dark)\.([a-zA-Z0-9]+)$/.exec(issue.path);
    if (!m) continue;
    const mode = m[2] as Mode;
    let value = get(theme, issue.path);
    const seen = new Set<string>();
    while (typeof value === 'string') {
      const ref = /^\{(color|brand)\.([a-zA-Z0-9]+)\}$/.exec(value);
      if (!ref) break;
      const path = ref[1] === 'brand' ? `tokens.brand.${ref[2]}` : `tokens.color.${mode}.${ref[2]}`;
      if (seen.has(path)) break;
      seen.add(path);
      add(path, issue.message);
      value = ref[1] === 'brand' ? undefined : theme.tokens.color[mode]?.[ref[2]];
    }
  }
  return out;
}
