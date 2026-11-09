// The native theme registry: every theme, both modes, with colours, component parts, materials and the
// player chrome evaluated into plain data. The native generators turn this into one file per platform,
// so an app can switch to the theme an admin sets (`site.theme`) at run time, without a rebuild.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CssEvaluator, type Fill, type Rgba, type Shadow } from './css-value.ts';
import { kebab } from './model.ts';
import { loadThemes, loadTokens, resolveTheme, THEMES_DIR, themeModel, type Themes } from './themes.ts';

type Node = Record<string, any>;
export const MODES = ['light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

/** What the apps show when `site.theme` cannot be read and nothing is cached. Matches DEFAULT_SITE_THEME (#492). */
export const NATIVE_FALLBACK = 'fawanees';

export const MATERIAL_FILLS = ['glow', 'page', 'header', 'rail', 'card', 'border', 'raised', 'control', 'primary', 'primaryHover', 'primaryPress', 'active', 'hover', 'hero', 'sel', 'selBar'] as const;
export const MATERIAL_SHADOWS = ['headerEdge', 'railEdge', 'cardEdge', 'raisedEdge', 'controlEdge', 'primaryEdge', 'activeEdge', 'thumbEdge', 'selEdge', 'selGlow', 'player', 'playerInner', 'playerRing'] as const;
export const RADII = ['sm', 'md', 'lg', 'xl', 'pill'] as const;

export const PLAYER_FILLS = ['bar', 'track', 'buffered', 'played', 'handle', 'hover', 'press', 'tip-bg', 'menu', 'menu-hover', 'menu-selected', 'big', 'pill', 'cue', 'err', 'scrim'] as const;
export const PLAYER_COLORS = ['icon', 'dim', 'tip-text', 'accent', 'big-icon', 'spin', 'pill-edge', 'live', 'live-text'] as const;
export const PLAYER_SHADOWS = ['bar-edge', 'track-edge', 'glow', 'handle-edge', 'tip-edge', 'menu-edge', 'big-edge'] as const;

export const camel = (s: string) => s.replace(/[-.]([a-z])/g, (_, c: string) => c.toUpperCase());

export interface Blur { radius: number; saturate: number }
export interface NativeMode {
  colors: Record<string, Rgba>;
  parts: Record<string, Rgba>;
  fills: Record<(typeof MATERIAL_FILLS)[number], Fill[]>;
  shadows: Record<(typeof MATERIAL_SHADOWS)[number], Shadow[]>;
}
export interface NativePlayer {
  fills: Record<string, Fill[]>;
  colors: Record<string, Rgba>;
  shadows: Record<string, Shadow[]>;
  barPad: [number, number, number, number];
  barInset: number;
  barRadius: number;
  /** Corner radius of a control's hover fill; -1 means a circle. */
  shape: number;
  blur: Blur | null;
}
export interface NativeTheme {
  id: string;
  name: { en: string; ar: string };
  font: { latin: string[]; arabic: string[] };
  radius: Record<(typeof RADII)[number], number>;
  blur: Blur | null;
  modes: Record<Mode, NativeMode>;
  player: NativePlayer;
  /** Motif SVGs with every var() resolved for the mode, keyed by asset name. */
  svg: Record<Mode, Record<string, string>>;
}
export interface NativeRegistry { ids: string[]; fallback: string; themes: NativeTheme[] }

const hexRgba = (hex: string): Rgba => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as Rgba;

function blurOf(value: string, where: string): Blur | null {
  if (value.trim() === 'none') return null;
  const m = /^blur\((\d+(?:\.\d+)?)px\)(?:\s+saturate\(([\d.]+)\))?$/.exec(value.trim());
  if (!m) throw new Error(`${where}: expected none or blur(Npx) [saturate(N)], got "${value}"`);
  return { radius: Number(m[1]), saturate: m[2] ? Number(m[2]) : 1 };
}

export function readJsonIn(dir: string, id: string, file: string): Node {
  const path = join(dir, id, file);
  if (!existsSync(path)) throw new Error(`${id}: themes/${id}/${file} is missing`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Resolves `var(--fanous-color-*)` in an SVG for one mode. Theme SVGs already passed `svgProblem`. */
export function resolveSvg(svg: string, colors: Record<string, string>, where: string): string {
  return svg.replace(/var\(--fanous-color-([a-z-]+)\)/g, (_, name: string) => {
    const hex = colors[name];
    if (!hex) throw new Error(`${where}: unknown colour var(--fanous-color-${name})`);
    return hex;
  });
}

export function buildNativeTheme(id: string, themes: Themes, tokens: Node, dir: string = THEMES_DIR): NativeTheme {
  const model = themeModel(id, themes, tokens);
  const resolved = resolveTheme(id, themes);
  const material = readJsonIn(dir, id, 'material.json');
  const player = readJsonIn(dir, id, 'player.json').player as Record<string, string>;
  const pair = tokens.font.pair[resolved.font];

  const modes = Object.fromEntries(MODES.map((mode) => {
    const semantic = Object.fromEntries(model.themes[mode].map((c) => [kebab(c.name), c.hex]));
    const parts = model.components[mode];
    const partVars = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k.split('.').map(kebab).join('-'), v]));
    const lookup = (name: string): string | undefined => {
      if (name.startsWith('fanous-color-')) return semantic[name.slice(13)];
      if (name.startsWith('fanous-c-')) return partVars[name.slice(9)];
      if (name.startsWith('m-')) return material.material[camel(name.slice(2))];
      return undefined;
    };
    const fills = Object.fromEntries(MATERIAL_FILLS.map((k) => {
      const v = material.material[k];
      if (v === undefined) throw new Error(`${id}: material.${k} is missing`);
      return [k, new CssEvaluator(lookup, `${id} ${mode} material.${k}`).fills(v)];
    })) as NativeMode['fills'];
    const shadows = Object.fromEntries(MATERIAL_SHADOWS.map((k) => {
      const v = material.material[k];
      if (v === undefined) throw new Error(`${id}: material.${k} is missing`);
      return [k, new CssEvaluator(lookup, `${id} ${mode} material.${k}`).shadows(v)];
    })) as NativeMode['shadows'];
    const known = new Set<string>([...MATERIAL_FILLS, ...MATERIAL_SHADOWS]);
    for (const k of Object.keys(material.material)) if (!known.has(k)) throw new Error(`${id}: material.${k} is not a material slot`);
    return [mode, {
      colors: Object.fromEntries(model.themes[mode].map((c) => [c.name, hexRgba(c.hex)])),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hexRgba(v)])),
      fills, shadows,
    } satisfies NativeMode];
  })) as Record<Mode, NativeMode>;

  const pev = (k: string) => new CssEvaluator(() => undefined, `${id} player.${k}`);
  const playerNative: NativePlayer = {
    fills: Object.fromEntries(PLAYER_FILLS.map((k) => [camel(k), pev(k).fills(player[k])])),
    colors: Object.fromEntries(PLAYER_COLORS.map((k) => [camel(k), pev(k).color(player[k])])),
    shadows: Object.fromEntries(PLAYER_SHADOWS.map((k) => [camel(k), pev(k).shadows(player[k])])),
    barPad: pev('bar-pad').box(player['bar-pad']),
    barInset: pev('bar-inset').length(player['bar-inset']),
    barRadius: pev('bar-radius').length(player['bar-radius']),
    shape: player.shape.trim() === '50%' ? -1 : pev('shape').length(player.shape),
    blur: blurOf(player.blur, `${id} player.blur`),
  };

  const radius = Object.fromEntries(RADII.map((r) => {
    const v = material.radius?.[r];
    if (v === undefined) throw new Error(`${id}: material radius.${r} is missing`);
    return [r, new CssEvaluator(() => undefined, `${id} radius.${r}`).length(v)];
  })) as NativeTheme['radius'];

  const svgSlots: Record<string, string | undefined> = {
    loader: resolved.motif?.loader,
    pattern: resolved.motif?.pattern === 'none' ? undefined : resolved.motif?.pattern,
    authHeader: undefined,
  };
  const svg = Object.fromEntries(MODES.map((mode) => {
    const semantic = Object.fromEntries(model.themes[mode].map((c) => [kebab(c.name), c.hex]));
    const files: Record<string, string> = {};
    for (const [name, rel] of Object.entries({ ...svgSlots, authHeader: resolved.auth?.headerGraphic?.[mode] })) {
      if (!rel) continue;
      files[name] = resolveSvg(readFileSync(join(dir, rel), 'utf8').trim(), semantic, `${id} ${mode} ${rel}`);
    }
    return [mode, files];
  })) as NativeTheme['svg'];

  return {
    id,
    name: { en: resolved.name.en, ar: resolved.name.ar },
    font: { latin: pair.latin.$value, arabic: pair.arabic.$value },
    radius,
    blur: blurOf(material.blur ?? 'none', `${id} material.blur`),
    modes,
    player: playerNative,
    svg,
  };
}

export function buildNativeRegistry(themes: Themes = loadThemes(), tokens: Node = loadTokens(), dir: string = THEMES_DIR): NativeRegistry {
  if (!themes.byId[NATIVE_FALLBACK]) throw new Error(`native fallback theme "${NATIVE_FALLBACK}" is not registered`);
  return { ids: themes.ids, fallback: NATIVE_FALLBACK, themes: themes.ids.map((id) => buildNativeTheme(id, themes, tokens, dir)) };
}
