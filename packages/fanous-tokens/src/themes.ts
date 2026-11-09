// The theme registry: loads themes/<id>/theme.json, walks `extends` chains into flat themes, and
// validates every slot. Pure given its inputs, so tests can pass in-memory themes.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AA_TEXT_ON_PRIMARY, contrastFailures, primaryTextFailures } from './contrast.ts';
import { buildModel, TOKENS_URL, type Model } from './model.ts';

type Node = Record<string, any>;
export interface Themes { defaultTheme: string; ids: string[]; byId: Record<string, Node> }

export const THEMES_DIR = fileURLToPath(new URL('../themes', import.meta.url));
const MODES = ['light', 'dark'] as const;
const isObject = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

export const loadTokens = (): Node => JSON.parse(readFileSync(TOKENS_URL, 'utf8'));

/** A relative asset path becomes `<owner>/assets/...`, so an inherited slot still finds its file. */
function ownPaths(value: any, owner: string): any {
  if (typeof value === 'string') return value.startsWith('assets/') ? `${owner}/${value}` : value;
  if (Array.isArray(value)) return value.map((v) => ownPaths(v, owner));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ownPaths(v, owner)]));
  return value;
}

export function loadThemes(dir: string = THEMES_DIR): Themes {
  const registry = readJson(join(dir, 'registry.json'));
  const byId = Object.fromEntries(registry.themes.map((id: string) => [id, ownPaths(readJson(join(dir, id, 'theme.json')), id)]));
  return { defaultTheme: registry.default, ids: registry.themes, byId };
}

/** The theme and its ancestors, nearest first. Throws on an unknown parent or a cycle. */
export function resolveChain(id: string, themes: Themes): string[] {
  const chain: string[] = [];
  for (let at: string | undefined = id; at !== undefined; at = themes.byId[at].extends) {
    if (chain.includes(at)) throw new Error(`${id}: cycle in extends: ${[...chain, at].join(' -> ')}`);
    if (!themes.byId[at]) throw new Error(`${id}: unknown parent theme "${at}" (chain: ${chain.join(' -> ')})`);
    chain.push(at);
  }
  return chain;
}

function merge(base: any, over: any): any {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Node = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/** The flat theme: ancestors first, so the nearest definition of each slot wins. */
export function resolveTheme(id: string, themes: Themes): Node {
  const flat = resolveChain(id, themes).reverse().reduce((acc, t) => merge(acc, themes.byId[t]), {} as Node);
  return { ...flat, id, extends: themes.byId[id].extends };
}

const roleNames = (tokens: Node) => Object.keys(tokens.color.roles).filter((k) => !k.startsWith('$'));
const scaleNames = ['none', 'sm', 'md', 'lg', 'xl', 'full'];
const elevationNames = ['low', 'medium', 'high'];
const BRAND_NAMES = ['night', 'nightDeep', 'nightShallow', 'lantern', 'glow', 'earth', 'parchment', 'verified', 'error'];

const FILE_SLOTS: Record<string, { png?: [number, number]; ico?: boolean; opaque?: boolean; og?: boolean; image?: boolean }> = {
  'brand.wordmark.light': { image: true }, 'brand.wordmark.dark': { image: true },
  'brand.logo.light': { image: true }, 'brand.logo.dark': { image: true },
  'brand.favicon': { ico: true },
  'brand.icon192': { png: [192, 192] }, 'brand.icon512': { png: [512, 512] }, 'brand.iconMaskable512': { png: [512, 512] },
  'brand.appleTouchIcon': { png: [180, 180], opaque: true },
  'brand.ogImage': { og: true },
  'email.headerImage': { png: undefined, image: true },
};
const SVG_SLOTS = ['motif.loader', 'auth.headerGraphic.light', 'auth.headerGraphic.dark'];
const VALUE_SLOTS = [
  'kind', 'name.en', 'name.ar', 'font', 'shape.borderStyle', 'motif.pattern',
  ...MODES.map((m) => `browser.themeColor.${m}`), 'browser.manifest.background', 'browser.manifest.theme',
  ...MODES.map((m) => `auth.background.${m}`),
  'email.background', 'email.text', 'email.buttonBackground', 'email.buttonText', 'email.buttonRadius',
];

/** Every required slot path. Colours are per mode, so the message names the mode. */
export function requiredSlots(tokens: Node): string[] {
  return [
    ...MODES.flatMap((m) => roleNames(tokens).map((n) => `color.${m}.${n}`)),
    ...BRAND_NAMES.map((n) => `brandColor.${n}`),
    ...scaleNames.map((n) => `shape.radius.${n}`),
    ...elevationNames.map((n) => `shape.elevation.${n}`),
    ...VALUE_SLOTS, ...Object.keys(FILE_SLOTS), ...SVG_SLOTS,
  ];
}

const slot = (theme: Node, path: string) => path.split('.').reduce<any>((n, k) => (n === undefined ? undefined : n[k]), theme);

export function imageInfo(buf: Buffer): { format: string; width?: number; height?: number; alpha?: boolean; sizes?: number[] } {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: buf[25] === 4 || buf[25] === 6 };
  }
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    return { format: 'ico', sizes: Array.from({ length: buf.readUInt16LE(4) }, (_, i) => buf[6 + i * 16] || 256) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { format: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { format: 'jpeg' };
  }
  return { format: buf.subarray(0, 200).toString('utf8').includes('<svg') ? 'svg' : 'unknown' };
}

export function svgProblem(text: string): string | undefined {
  if (!/<svg[\s>]/.test(text)) return 'is not an SVG';
  if (/<script|<foreignObject|\son[a-z]+\s*=/i.test(text)) return 'contains a script';
  if (/(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(text)) return 'contains an external reference';
  return undefined;
}

function checkFile(id: string, name: string, rel: unknown, dir: string, rule: (typeof FILE_SLOTS)[string], errors: string[]) {
  const file = join(dir, String(rel));
  if (!existsSync(file)) return void errors.push(`${id}: slot ${name} points to a missing file: ${rel}`);
  const info = imageInfo(readFileSync(file));
  const bad = (why: string) => errors.push(`${id}: slot ${name} (${rel}) ${why}`);
  if (rule.ico) {
    if (info.format !== 'ico') return void bad('must be an ICO');
    for (const size of [16, 32, 48]) if (!info.sizes!.includes(size)) bad(`is missing the ${size}px image`);
  } else if (rule.png) {
    if (info.format !== 'png') return void bad('must be a PNG');
    if (info.width !== rule.png[0] || info.height !== rule.png[1]) bad(`must be ${rule.png[0]}x${rule.png[1]}, found ${info.width}x${info.height}`);
    if (rule.opaque && info.alpha) bad('must have no alpha channel');
  } else if (rule.og) {
    if (!['png', 'jpeg'].includes(info.format)) return void bad('must be a PNG or JPEG');
    if (info.width !== 1200 || info.height !== 630) bad(`must be 1200x630, found ${info.width}x${info.height}`);
    if (statSync(file).size > 1024 * 1024) bad('must be at most 1 MB');
  } else if (!['png', 'svg'].includes(info.format)) bad('must be a PNG or SVG');
}

function checkSvg(id: string, name: string, rel: unknown, dir: string, errors: string[]) {
  const file = join(dir, String(rel));
  if (!existsSync(file)) return void errors.push(`${id}: slot ${name} points to a missing file: ${rel}`);
  const problem = svgProblem(readFileSync(file, 'utf8'));
  if (problem) errors.push(`${id}: slot ${name} (${rel}) ${problem}`);
}

/** Replaces the per-theme parts of the token tree, so buildModel and the generators need no theme logic. */
export function composeTokens(tokens: Node, theme: Node): Node {
  const out = structuredClone(tokens);
  const { $description, ...roles } = out.color.roles;
  const mode = (m: 'light' | 'dark') => Object.fromEntries(Object.entries<Node>(roles).map(([name, role]) => [name, { $value: theme.color[m][name], ...role }]));
  out.color.theme = { dark: mode('dark'), light: mode('light') };
  delete out.color.roles;
  for (const [name, value] of Object.entries(theme.brandColor)) out.color.brand[name].$value = value;
  out.font.family.latin.$value = `{font.pair.${theme.font}.latin}`;
  out.font.family.arabic.$value = `{font.pair.${theme.font}.arabic}`;
  out.radius = { $type: 'dimension', ...Object.fromEntries(Object.entries(theme.shape.radius).map(([k, v]) => [k, { $value: v }])) };
  out.elevation = { $type: 'shadow', ...Object.fromEntries(Object.entries(theme.shape.elevation).map(([k, v]) => [k, { $value: v }])) };
  return out;
}

const EXEMPT_HUE = /^(verified|onVerified|successText|errorText|errorFill|onErrorFill|verifiedIcon)/;
function hueOf(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min; const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return { h, sat };
}

/** Every theme stays in the logo's teal and navy or ember and gold hues. Status colours are shared meanings. */
export function offLogoColors(model: Model): string[] {
  const off: string[] = [];
  for (const [mode, colors] of Object.entries(model.themes)) {
    for (const c of colors) {
      if (EXEMPT_HUE.test(c.name)) continue;
      const { h, sat } = hueOf(c.hex);
      if (!(sat < 0.08 || (h >= 5 && h <= 48) || (h >= 172 && h <= 212))) off.push(`${mode}.${c.name} ${c.hex} is outside the logo's hues (H${Math.round(h)})`);
    }
  }
  return off;
}

export const themeModel = (id: string, themes: Themes, tokens: Node): Model => buildModel(composeTokens(tokens, resolveTheme(id, themes)));

/** All problems with every registered theme, each naming the theme and the slot. */
export function validateThemes(themes: Themes, tokens: Node, dir: string = THEMES_DIR): string[] {
  const errors: string[] = [];
  if (!themes.byId[themes.defaultTheme]) errors.push(`registry: default theme "${themes.defaultTheme}" is not registered`);
  const roles = roleNames(tokens);
  for (const id of themes.ids) {
    let chain: string[];
    try { chain = resolveChain(id, themes); } catch (e) { errors.push((e as Error).message); continue; }
    const theme = resolveTheme(id, themes);
    const before = errors.length;
    for (const path of requiredSlots(tokens)) {
      if (slot(theme, path) !== undefined) continue;
      errors.push(chain.length === 1 ? `${id}: slot ${path} is missing (standalone theme)` : `${id}: slot ${path} is unresolved after walking ${chain.join(' -> ')}`);
    }
    for (const m of MODES) for (const n of Object.keys(theme.color?.[m] ?? {})) if (!roles.includes(n)) errors.push(`${id}: color.${m}.${n} is not a known colour`);
    if (errors.length > before) continue;
    if (!tokens.font.pair[theme.font]) errors.push(`${id}: slot font names unknown pair "${theme.font}"`);
    for (const [name, rule] of Object.entries(FILE_SLOTS)) checkFile(id, name, slot(theme, name), dir, rule, errors);
    for (const name of SVG_SLOTS) checkSvg(id, name, slot(theme, name), dir, errors);
    if (theme.motif.pattern !== 'none') checkSvg(id, 'motif.pattern', theme.motif.pattern, dir, errors);
    if (theme.banner?.enabled) {
      for (const lang of ['en', 'ar']) {
        const text = theme.banner.text?.[lang];
        if (!text) errors.push(`${id}: slot banner.text.${lang} is missing (a banner needs both languages)`);
        else if (text.length > 90) errors.push(`${id}: slot banner.text.${lang} is longer than 90 characters`);
      }
    }
    let model: Model;
    try { model = themeModel(id, themes, tokens); } catch (e) { errors.push(`${id}: ${(e as Error).message}`); continue; }
    for (const p of contrastFailures(model)) errors.push(`${id}: AA failure in ${p.theme}: ${p.fg} ${p.fgHex} on ${p.bg} ${p.bgHex} = ${p.ratio.toFixed(2)} (needs ${p.required})`);
    for (const p of primaryTextFailures(model)) errors.push(`${id}: text on primary in ${p.theme}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (needs ${AA_TEXT_ON_PRIMARY})`);
    for (const c of offLogoColors(model)) errors.push(`${id}: ${c}`);
  }
  return errors;
}
