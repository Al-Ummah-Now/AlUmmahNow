// The Al Ummah Now favicon family: one Fanous lantern brand, one tile and glyph per app.
// Colours come from the Fanous tokens, so a brand colour change flows through here too.
//
// Public sites sit on a rounded square. Staff tools sit on an octagonal "seal" with a gold ring,
// so a staff tab never looks like a public one, and they carry the glyph of the site they manage:
// videos admin = play, CMS = lantern (it edits www), accounts admin = star (it manages accounts).
// Non-production hosts add a corner dot: QA violet, stage pink.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = JSON.parse(readFileSync(join(HERE, '../../fanous-tokens/tokens/fanous.tokens.json'), 'utf8'));
const tok = (path: string): string => {
  const [group, name] = path.split('.');
  const value = TOKENS.color?.[group]?.[name]?.$value;
  if (typeof value !== 'string') throw new Error(`fanous token color.${path} not found`);
  return value;
};

export const C = {
  night: tok('brand.night'),
  nightHigh: tok('derived.nightHigh'),
  ink: tok('derived.inkNight'),
  parchment: tok('brand.parchment'),
  lantern: tok('brand.lantern'),
  glow: tok('brand.glow'),
  gold: tok('derived.gold'),
  goldLight: tok('derived.goldLight'),
  teal: tok('derived.tealGlass'),
  tealDeep: tok('derived.tealDeep'),
  tealMist: tok('derived.tealMist'),
};

/** Environment marker colours. Not brand colours on purpose: they must not read as part of a mark. */
export const ENV_DOT = { qa: '#7c3aed', stage: '#db2777' } as const;
export type Env = 'prod' | 'qa' | 'stage';
export type Scheme = 'light' | 'dark';

const S = (s: number) => `translate(16 16) scale(${s}) translate(-16 -16)`;
const ROUNDED = `<rect class="t" width="32" height="32" rx="7"/>`;
const OCT_RING = 'M11.1 2.3h9.8l8.8 8.8v9.8l-8.8 8.8h-9.8l-8.8-8.8v-9.8z';
const OCTAGON = `<path class="t" d="M10.4.5h11.2l9.9 9.9v11.2l-9.9 9.9H10.4L.5 21.6V10.4z"/><path class="r" fill="none" stroke-width="1.6" d="${OCT_RING}"/>`;
const OUTLINE = `<rect class="o" x=".75" y=".75" width="30.5" height="30.5" rx="6.3" fill="none" stroke-width="1.5"/>`;

/** The base mark: a geometric fanous (finial, dome, band, body with a lit pointed-arch window, foot). */
const lantern = (s = 1) => `<g transform="${S(s)}"><path class="g" d="M15 3.2h2v2.3h-2zM9.6 12.2C9.9 8.9 13 7.6 16 5.2c3 2.4 6.1 3.7 6.4 7z"/><rect class="g" x="8.6" y="12.2" width="14.8" height="2.4" rx=".6"/><path class="g" d="M10 14.6h12v10.6H10z"/><path class="w" d="M12.9 24.2v-5.4c0-1.8 1.5-2.9 3.1-3.9 1.6 1 3.1 2.1 3.1 3.9v5.4z"/><rect class="g" x="8" y="25" width="16" height="3" rx=".8"/></g>`;
const play = (s = 1) => `<path class="g" transform="${S(s)}" d="M11.5 7.6c0-1.3 1.4-2.1 2.5-1.4l12.3 8.4c1 .7 1 2.1 0 2.8L14 25.8c-1.1.7-2.5-.1-2.5-1.4z"/>`;
/** A keyhole with a pointed-arch head: the sign-in door. */
const keyhole = (s = 1) => `<path class="g" transform="${S(s)}" d="M16 5.2c2.6 1.6 5 3.6 5 6.8 0 2.1-1.1 3.9-2.7 4.9l1.9 9.3h-8.4l1.9-9.3c-1.6-1-2.7-2.8-2.7-4.9 0-3.2 2.4-5.2 5-6.8z"/>`;
/** Eight-point star (two squares): the geometric avatar Fanous uses instead of a person silhouette. */
const star = (s = 1) => {
  const r = 11.6;
  const square = (rot: number) => [0, 1, 2, 3].map((i) => {
    const a = (Math.PI / 2) * i + rot;
    return `${(16 + r * Math.cos(a)).toFixed(2)} ${(16 + r * Math.sin(a)).toFixed(2)}`;
  }).join('L');
  return `<g transform="${S(s)}"><path class="g" d="M${square(Math.PI / 4)}zM${square(0)}z"/><circle class="t" cx="16" cy="16" r="2.2"/></g>`;
};

type Palette = Record<string, string>;
export interface AppIcon {
  /** Full name for the web manifest. */
  name: string;
  short: string;
  staff: boolean;
  tile: string;
  glyph: string;
  light: Palette;
  dark: Palette;
  /** Manifest background/theme colour (a tile colour, so the splash matches the icon). */
  manifest: { background: string; theme: string };
}

export const APPS = {
  www: {
    name: 'Al Ummah Now', short: 'Al Ummah Now', staff: false, tile: ROUNDED, glyph: lantern(),
    light: { t: C.night, g: C.gold, w: C.lantern }, dark: { t: C.nightHigh, g: C.goldLight, w: C.lantern },
    manifest: { background: C.night, theme: C.night },
  },
  videos: {
    name: 'Al Ummah Now Videos', short: 'Videos', staff: false, tile: ROUNDED, glyph: play(),
    light: { t: C.lantern, g: C.night }, dark: { t: C.glow, g: C.night },
    manifest: { background: C.night, theme: C.night },
  },
  auth: {
    name: 'Al Ummah Now Sign in', short: 'Sign in', staff: false, tile: ROUNDED + OUTLINE, glyph: keyhole(),
    light: { t: C.parchment, o: C.night, g: C.night }, dark: { t: C.parchment, o: C.parchment, g: C.night },
    manifest: { background: C.parchment, theme: C.night },
  },
  profile: {
    name: 'Al Ummah Now Account', short: 'Account', staff: false, tile: ROUNDED, glyph: star(),
    light: { t: C.tealDeep, g: C.parchment }, dark: { t: C.teal, g: C.parchment },
    manifest: { background: C.tealDeep, theme: C.tealDeep },
  },
  'videos-admin': {
    name: 'Al Ummah Now Videos Admin', short: 'Videos Admin', staff: true, tile: OCTAGON, glyph: play(0.78),
    light: { t: C.ink, r: C.gold, g: C.lantern }, dark: { t: C.ink, r: C.goldLight, g: C.glow },
    manifest: { background: C.ink, theme: C.ink },
  },
  cms: {
    name: 'Al Ummah Now CMS', short: 'CMS', staff: true, tile: OCTAGON, glyph: lantern(0.8),
    light: { t: C.ink, r: C.gold, g: C.gold, w: C.lantern }, dark: { t: C.ink, r: C.goldLight, g: C.goldLight, w: C.lantern },
    manifest: { background: C.ink, theme: C.ink },
  },
  'auth-admin': {
    name: 'Al Ummah Now Accounts Admin', short: 'Accounts Admin', staff: true, tile: OCTAGON, glyph: star(0.74),
    light: { t: C.ink, r: C.gold, g: C.teal }, dark: { t: C.ink, r: C.goldLight, g: C.tealMist },
    manifest: { background: C.ink, theme: C.ink },
  },
} satisfies Record<string, AppIcon>;
export type AppId = keyof typeof APPS;
export const APP_IDS = Object.keys(APPS) as AppId[];

const css = (p: Palette) => Object.entries(p).map(([k, v]) => `.${k}{${k === 'r' || k === 'o' ? 'stroke' : 'fill'}:${v}}`).join('');
const svgDoc = (style: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>${style}</style>${body}</svg>\n`;
const envDot = (env: Env) => env === 'prod' ? '' : `<circle cx="25.5" cy="25.5" r="6.2" fill="#fff"/><circle cx="25.5" cy="25.5" r="4.6" fill="${ENV_DOT[env]}"/>`;

/**
 * The tab icon. Without `scheme` it carries both palettes, switched by prefers-color-scheme inside
 * the SVG; with `scheme` it is fixed (for rasterising: PNG and ICO).
 */
export function faviconSvg(app: AppId, opts: { env?: Env; scheme?: Scheme } = {}): string {
  const a: AppIcon = APPS[app];
  const style = opts.scheme ? css(a[opts.scheme]) : `${css(a.light)}@media(prefers-color-scheme:dark){${css(a.dark)}}`;
  return svgDoc(style, a.tile + a.glyph + envDot(opts.env ?? 'prod'));
}

/**
 * Full-bleed, opaque square for apple-touch-icon and the maskable manifest icon: the tile colour
 * fills the canvas (the platform applies its own mask) and the glyph sits inside `safe` of it.
 * Staff icons keep a smaller gold octagon ring so they stay distinct on a home screen.
 */
export function bleedSvg(app: AppId, safe: number): string {
  const a: AppIcon = APPS[app];
  const p = a.light;
  const ring = a.staff ? `<path class="r" fill="none" stroke-width="1.3" d="${OCT_RING}" transform="${S(safe + 0.12)}"/>` : '';
  return svgDoc(css(p), `<rect width="32" height="32" fill="${p.t}"/>${ring}<g transform="${S(safe)}">${a.glyph}</g>`);
}
