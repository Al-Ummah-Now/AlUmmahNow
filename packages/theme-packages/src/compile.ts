// Compiles a theme package to the CSS the apps read: design tokens (--fanous-*), materials
// (--r-*, --m-*), body fonts and player chrome (--fanous-player-*), all scoped to
// html[data-theme='<id>'] so several themes can share one stylesheet.
import { BASE } from './base.generated.ts';
import { BRAND_NAMES, COMPONENT_PARTS, ELEVATION_NAMES, MATERIAL_VARS, OPTIONAL_MATERIAL_VARS, PLAYER_SHARED, PLAYER_TOKENS, RADIUS_NAMES, get } from './components.ts';
import { kebab, toCss } from './refs.ts';
import { MODES, type Mode, type ThemePackage } from './types.ts';

export interface CompileOptions {
  /** URL for an asset path such as assets/pattern.svg. Defaults to the path itself. */
  assetUrl?: (path: string) => string;
  /** The platform default theme: also styles a page whose <html> has no data-theme. */
  isDefault?: boolean;
  /**
   * Built-in themes keep the `:root` fallback the shared stylesheet has always had, so the
   * generated file is unchanged. Packages served on their own leave it out.
   */
  rootFallback?: boolean;
  /**
   * Inline form of an asset (a data: URL) for values that must work wherever the stylesheet is
   * copied (the street's lights in the built-in stylesheet, which www and the CMS vendor).
   * Falls back to assetUrl.
   */
  inlineAsset?: (path: string) => string | undefined;
  /**
   * The text of an SVG asset. The header graphic is compiled from it with this theme's colours
   * for each mode (see artCss); without it the art is `none`.
   */
  svgText?: (path: string) => string | undefined;
  /**
   * Where a compiled art file is served. Built-in themes: a static file per theme and mode
   * (build-themes.ts), fetched only by an element that paints it. Default: an inline data: URL.
   */
  artUrl?: (mode: Mode, svg: string) => string;
}

export interface CompiledTheme { tokens: string; materials: string; fonts: string; player: string; art: string; css: string }

export const scopeOf = (id: string) => `html[data-theme='${id}']`;

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
/** Token stacks quote only names with spaces, as the platform tokens always have. */
const tokenStack = (families: readonly string[]) => families.map((f) => (/\s/.test(f) ? `'${f}'` : f)).join(', ');
/** Body stacks quote every family name and leave generic families bare. */
const bodyStack = (families: readonly string[]) => families.map((f) => (GENERIC.has(f) ? f : `'${f}'`)).join(',');
const num = (px: string) => String(Number(px.replace(/px$/, '')));

/** Resolves {color.*} and {brand.*} in a colour slot to #rrggbb. Throws on an unknown name or a cycle. */
export function resolveColor(pkg: ThemePackage, mode: Mode, value: string, seen: string[] = []): string {
  const m = /^\{(color|brand)\.([a-zA-Z0-9]+)\}$/.exec(value);
  if (!m) return value.toLowerCase();
  if (m[1] === 'brand') {
    const brand = pkg.tokens.brand[m[2]];
    if (!brand) throw new Error(`unknown brand colour ${m[2]}`);
    return brand.toLowerCase();
  }
  if (seen.includes(m[2])) throw new Error(`colour references loop: ${[...seen, m[2]].join(' -> ')}`);
  const next = pkg.tokens.color[mode][m[2]];
  if (next === undefined) throw new Error(`unknown colour role ${m[2]}`);
  return resolveColor(pkg, mode, next, [...seen, m[2]]);
}

/** Every role and component part, per mode, as #rrggbb. */
export function resolvedColors(pkg: ThemePackage) {
  const out = {} as Record<Mode, { roles: Record<string, string>; parts: Record<string, string> }>;
  for (const mode of MODES) {
    const roles = Object.fromEntries(BASE.roles.map((r) => [r.name, resolveColor(pkg, mode, pkg.tokens.color[mode][r.name])]));
    const parts = Object.fromEntries(BASE.parts.map(({ part }) => {
      const dot = part.lastIndexOf('.');
      const section = Object.entries(PART_SECTIONS).find(([, group]) => group === part.slice(0, dot))?.[0];
      const value = section ? pkg.components[section]?.colors?.[mode]?.[part.slice(dot + 1)] : undefined;
      if (value === undefined) throw new Error(`component colour ${part} is missing`);
      return [part, resolveColor(pkg, mode, value)];
    }));
    out[mode] = { roles, parts };
  }
  return out;
}

const PART_SECTIONS = Object.fromEntries(Object.entries(COMPONENT_PARTS).filter(([, g]) => g !== null)) as Record<string, string>;

function tokensCss(pkg: ThemePackage, opts: CompileOptions): string {
  const scope = scopeOf(pkg.id);
  const top = opts.isDefault ? `:root, ${scope}` : scope;
  const dark = opts.isDefault ? `.dark, ${scope}.dark` : `${scope}.dark`;
  const light = opts.isDefault ? `html:not(.dark), ${scope}:not(.dark)` : `${scope}:not(.dark)`;
  const colors = resolvedColors(pkg);
  const px = (prefix: string, items: readonly { name: string; value: number }[]) => items.map((i) => `  --fanous-${prefix}-${kebab(i.name)}: ${i.value}px;`).join('\n');
  const type = (script: string, styles: readonly { name: string; size: number; weight: number; lineHeight: number; letterSpacing: number }[]) => styles.map((s) => {
    const base = `--fanous-type-${script}-${kebab(s.name)}`;
    return `  ${base}-size: ${s.size}px;\n  ${base}-weight: ${s.weight};\n  ${base}-line-height: ${s.lineHeight};\n  ${base}-letter-spacing: ${s.letterSpacing}px;`;
  }).join('\n');
  const spacing = BASE.spacing.map((s) => ({ name: s.name, value: pkg.tokens.spacing?.[s.name] ?? s.value }));
  const elevation = ELEVATION_NAMES.map((name) => {
    const e = pkg.tokens.elevation[name];
    const c = e.color.toLowerCase();
    const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(' ');
    const alpha = c.length === 9 ? Math.round((parseInt(c.slice(7), 16) / 255) * 100) / 100 : 1;
    return `  --fanous-elevation-${name}: ${num(e.offsetX)}px ${num(e.offsetY)}px ${num(e.blur)}px ${num(e.spread)}px rgb(${rgb} / ${alpha});`;
  });
  const modeBlock = (mode: Mode) => [
    ...BASE.roles.map((r) => `  --fanous-color-${kebab(r.name)}: ${colors[mode].roles[r.name]};`),
    ...BASE.parts.map(({ part }) => `  --fanous-c-${part.split('.').map(kebab).join('-')}: ${colors[mode].parts[part]};`),
    ...streetTokens(pkg, mode, opts),
  ].join('\n');
  return `/* Theme package ${pkg.id}@${pkg.version}. Generated, do not edit. */
${top} {
${BRAND_NAMES.map((n) => `  --fanous-brand-${kebab(n)}: ${pkg.tokens.brand[n].toLowerCase()};`).join('\n')}
  --fanous-font-latin: ${tokenStack(pkg.typography.latin)};
  --fanous-font-arabic: ${tokenStack(pkg.typography.arabic)};
${BASE.fontPairs.flatMap((p) => [`  --fanous-font-${kebab(p.name)}-latin: ${tokenStack(p.latin)};`, `  --fanous-font-${kebab(p.name)}-arabic: ${tokenStack(p.arabic)};`]).join('\n')}
${type('latin', BASE.typography.latin)}
${type('arabic', BASE.typography.arabic)}
${px('spacing', spacing)}
${RADIUS_NAMES.map((n) => `  --fanous-radius-${n}: ${num(pkg.tokens.radius[n])}px;`).join('\n')}
${elevation.join('\n')}
${BASE.duration.map((d) => `  --fanous-duration-${kebab(d.name)}: ${d.value}ms;`).join('\n')}
${BASE.easing.map((e) => `  --fanous-easing-${kebab(e.name)}: cubic-bezier(${e.value.join(', ')});`).join('\n')}
${px('focus', BASE.focus)}
${px('tv', BASE.tv)}
${px('layout', BASE.layout)}
}

@media (prefers-reduced-motion: reduce) {
  ${opts.rootFallback ? ':root' : top} {
${BASE.duration.filter((d) => d.name !== 'instant').map((d) => `    --fanous-duration-${kebab(d.name)}: 0ms;`).join('\n')}
  }
}

/* Dark (night) is the default theme. */
${opts.rootFallback ? ':root,\n' : ''}${dark} {
${modeBlock('dark')}
}

${light} {
${modeBlock('light')}
}
`;
}

/**
 * The street's tokens for one mode. The shared street module reads them: --fanous-street-on 1
 * switches it on; a theme without a street sets 0.
 */
/**
 * The street's tiles (raster, so never inlined): a built-in theme's are served by every app at
 * /fanous/street/<file>; an uploaded package's comes from its own asset URL. image-set(… 2x) shows
 * the 2x tile at its CSS size, with no background-size.
 */
function tileTokens(street: NonNullable<ThemePackage['street']>, mode: Mode, opts: CompileOptions): string[] {
  const url = (p: string) => (opts.assetUrl ? opts.assetUrl(p) : `/fanous/street/${p.split('/').pop()}`);
  const files = street.tile?.[mode] ?? [];
  const tile = (file: string) => `image-set(url("${url(file)}") 2x)`;
  return [
    // The first variant is the default; --fanous-street-tile-<n> are the variants the page picks
    // from (fanous-street.css). An unused custom property never fetches its image.
    `  --fanous-street-tile: ${files[0] ? tile(files[0]) : 'none'};`,
    ...files.map((file, i) => `  --fanous-street-tile-${i + 1}: ${tile(file)};`),
    `  --fanous-street-faint: ${street.faint?.[mode] ?? 1};`,
    `  --fanous-street-lights-opacity: ${street.lightsOpacity?.[mode] ?? 1};`,
  ];
}

function streetTokens(pkg: ThemePackage, mode: Mode, opts: CompileOptions): string[] {
  const street = pkg.street;
  // Off, explicitly: the default theme's blocks also match unthemed selectors (html:not(.dark), .dark)
  if (!street) return ['  --fanous-street-on: 0;'];
  const lights = opts.inlineAsset?.(street.lights[mode]) ?? (opts.assetUrl ?? ((p: string) => p))(street.lights[mode]);
  return [
    `  --fanous-street-on: ${street.enabled ? 1 : 0};`,
    `  --fanous-street-line: ${street.line[mode].toLowerCase()};`,
    `  --fanous-street-window: ${street.window[mode].toLowerCase()};`,
    `  --fanous-street-glow: ${street.glow[mode]};`,
    `  --fanous-street-lights: url("${lights}");`,
    ...tileTokens(street, mode, opts),
  ];
}

/** `components.<name>.lightStyle.<field>` for a `components.<name>.style.<field>` path. */
export const lightPath = (path: string) => path.replace('.style.', '.lightStyle.');

function materialsCss(pkg: ThemePackage, assetUrl: (p: string) => string): string {
  const decls = MATERIAL_VARS.map(([path, prop]) => `${prop}:${toCss(String(get(pkg, path)), assetUrl)}`);
  for (const [path, prop] of OPTIONAL_MATERIAL_VARS) {
    const value = get(pkg, path);
    if (value !== undefined && value !== '') decls.push(`${prop}:${toCss(String(value), assetUrl)}`);
  }
  // Light-only styles: the same properties again for light mode (the videos app marks dark with html.dark)
  const light: string[] = [];
  for (const [path, prop] of [...MATERIAL_VARS, ...OPTIONAL_MATERIAL_VARS]) {
    if (!path.startsWith('components.')) continue;
    const value = get(pkg, lightPath(path));
    if (value !== undefined && value !== '') light.push(`${prop}:${toCss(String(value), assetUrl)}`);
  }
  const scope = scopeOf(pkg.id);
  return `${scope}{${decls.join(';')}}\n${light.length ? `${scope}:not(.dark){${light.join(';')}}\n` : ''}`;
}

const BODY_TARGETS = ['body', 'body button', 'body input', 'body textarea', 'body select', 'body .font-inter'];

function fontsCss(pkg: ThemePackage, assetUrl: (p: string) => string): string {
  const scope = scopeOf(pkg.id);
  const faces = (pkg.typography.faces ?? []).map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style ?? 'normal'};font-display:swap;src:${toCss(`{asset:${f.src}}`, assetUrl)} format('woff2')}\n`).join('');
  const body = pkg.typography.body;
  if (!body) return faces;
  const rule = (sel: string, stack: string[]) => `${BODY_TARGETS.map((t) => `${sel} ${t}`).join(',')}{font-family:${bodyStack(stack)}}`;
  return `${faces}${rule(scope, body.latin)}\n${rule(`${scope}[lang=ar]`, body.arabic)}\n`;
}

function playerCss(pkg: ThemePackage, assetUrl: (p: string) => string): string {
  const chrome = pkg.components.player.chrome ?? {};
  const lines = [
    // An absent optional field (bar-pad-compact) is left out; the skin falls back to bar-pad
    ...PLAYER_TOKENS.filter((name) => chrome[name] !== undefined && chrome[name] !== '').map((name) => `  --fanous-player-${name}: ${toCss(String(chrome[name]), assetUrl)};`),
    ...Object.entries(PLAYER_SHARED).map(([name, value]) => `  --fanous-player-${name}: ${value};`),
  ];
  return `${scopeOf(pkg.id)} {\n${lines.join('\n')}\n}\n`;
}

/** `var(--fanous-color-x)` / `var(--fanous-c-x)` (with or without a fallback) in an SVG asset */
const SVG_VAR = /var\(\s*(--fanous-(?:color|c)-[a-z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;

/**
 * The theme's own artwork for one mode, with the page colours it references (var(--fanous-…))
 * written in. An SVG drawn as an image cannot read the page's custom properties, so it is
 * compiled per theme and mode; the CSS then picks it by html[data-theme] and html.dark, like
 * every other token, and switching theme switches the art. The source is imagery.headerGraphic;
 * a package without one uses its imagery.pattern (tiled), and with neither the art is none.
 */
/** The SVG files the art can come from (imagery.headerGraphic per mode, else an SVG pattern): what a
 * caller must hand `svgText`, e.g. the builder preview fetching a draft's assets. */
export function artSvgPaths(pkg: ThemePackage): string[] {
  const imagery = (pkg.imagery ?? {}) as Record<string, string | { light?: string; dark?: string } | undefined>;
  const header = imagery.headerGraphic;
  const pattern = imagery.pattern;
  const paths = typeof header === 'object' && header ? [header.light, header.dark] : [];
  // The pattern is read only for a mode with no header graphic
  const bothModes = typeof header === 'object' && header?.light && header?.dark;
  if (!bothModes && typeof pattern === 'string' && pattern.endsWith('.svg')) paths.push(pattern);
  return [...new Set(paths.filter((p): p is string => typeof p === 'string' && p.endsWith('.svg')))];
}

export function compiledArt(pkg: ThemePackage, mode: Mode, svgText: (path: string) => string | undefined, colors = resolvedColors(pkg)): { svg: string; tiled: boolean } | null {
  const imagery = (pkg.imagery ?? {}) as Record<string, string | { light?: string; dark?: string } | undefined>;
  const header = imagery.headerGraphic;
  const pattern = imagery.pattern;
  const source = typeof header === 'object' && header?.[mode]
    ? { path: header[mode] as string, tiled: false }
    : typeof pattern === 'string' && pattern !== 'none' && pattern.endsWith('.svg') ? { path: pattern, tiled: true } : null;
  if (!source) return null;
  const text = svgText(source.path);
  if (!text) return null;
  const values = new Map<string, string>([
    ...BASE.roles.map((r) => [`--fanous-color-${kebab(r.name)}`, colors[mode].roles[r.name]] as [string, string]),
    ...BASE.parts.map(({ part }) => [`--fanous-c-${part.split('.').map(kebab).join('-')}`, colors[mode].parts[part]] as [string, string]),
  ]);
  const svg = text.trim().replace(SVG_VAR, (whole, name: string, fallback?: string) => values.get(name) ?? fallback?.trim() ?? whole);
  return { svg, tiled: source.tiled };
}

/**
 * imagery.headerGraphicFrame "band": the art is drawn as a band rising out of the box it heads (Auth's
 * sign-in card shows it flush with the card's top edge, clipped by its corners, the card continuing
 * below). Boxes that show the art (the home page's sign-in banner) read these to frame it that way;
 * without them they inset it. Values, not selectors, so a copy of the theme keeps its framing.
 */
function frameVars(pkg: ThemePackage, svg: string): string[] {
  if ((pkg.imagery as Record<string, unknown> | undefined)?.headerGraphicFrame !== 'band') return [];
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  const ratio = box && Number(box[1]) > 0 && Number(box[2]) > 0 ? `${Number(box[1])} / ${Number(box[2])}` : '400 / 110';
  return [
    '  --fanous-header-graphic-frame: band;',
    '  --fanous-header-graphic-bleed: 1;',
    `  --fanous-header-graphic-ratio: ${ratio};`,
    '  --fanous-header-graphic-align: start;',
    '  --fanous-header-graphic-position: center bottom;',
    '  --fanous-header-graphic-fit: 100% auto;',
    // Alpha masks: the band's filled bottom fades into the box; beside other content its ends fade too
    '  --fanous-header-graphic-fade: linear-gradient(black 72%, transparent);',
    '  --fanous-header-graphic-mask: linear-gradient(black 72%, transparent), linear-gradient(90deg, transparent, black 12%, black 88%, transparent);',
  ];
}

function artCss(pkg: ThemePackage, opts: CompileOptions): string {
  const scope = scopeOf(pkg.id);
  const dark = opts.isDefault ? `.dark, ${scope}.dark` : `${scope}.dark`;
  const light = opts.isDefault ? `html:not(.dark), ${scope}:not(.dark)` : `${scope}:not(.dark)`;
  const colors = resolvedColors(pkg);
  const block = (mode: Mode) => {
    const art = opts.svgText ? compiledArt(pkg, mode, opts.svgText, colors) : null;
    if (!art) return '  --fanous-header-graphic: none;';
    const url = opts.artUrl ? opts.artUrl(mode, art.svg) : `data:image/svg+xml,${encodeURIComponent(art.svg)}`;
    return [
      `  --fanous-header-graphic: url("${url}");`,
      `  --fanous-header-graphic-size: ${art.tiled ? '96px auto' : 'contain'};`,
      `  --fanous-header-graphic-repeat: ${art.tiled ? 'repeat' : 'no-repeat'};`,
      ...(art.tiled ? [] : frameVars(pkg, art.svg)),
    ].join('\n');
  };
  return `${dark} {\n${block('dark')}\n}\n${light} {\n${block('light')}\n}\n`;
}

/** The package's CSS. Validate first: compiling an invalid package throws or emits broken CSS. */
export function compilePackage(pkg: ThemePackage, opts: CompileOptions = {}): CompiledTheme {
  const assetUrl = opts.assetUrl ?? ((p: string) => p);
  const tokens = tokensCss(pkg, opts);
  const materials = materialsCss(pkg, assetUrl);
  const fonts = fontsCss(pkg, assetUrl);
  const player = playerCss(pkg, assetUrl);
  const art = artCss(pkg, opts);
  return { tokens, materials, fonts, player, art, css: [tokens, fonts, materials, player, art].join('\n') };
}
