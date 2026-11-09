// Reads the W3C-format token file, resolves {aliases} and returns a typed model for the generators.

export type Role = 'surface' | 'fill' | 'text' | 'on' | 'nontext' | 'decorative';
export interface Named<T> { name: string; value: T; description?: string }
export interface ThemeColor { name: string; hex: string; role: Role; on?: string; description?: string }
export interface TextStyle { name: string; size: number; weight: number; lineHeight: number; letterSpacing: number }
export interface Shadow { name: string; hex: string; alpha: number; x: number; y: number; blur: number; spread: number }
export interface FontPair { name: string; latin: string[]; arabic: string[] }

export interface Model {
  brand: Named<string>[];
  derived: Named<string>[];
  themes: { dark: ThemeColor[]; light: ThemeColor[] };
  fontPairs: FontPair[];
  activePair: string;
  typography: { latin: TextStyle[]; arabic: TextStyle[] };
  numerals: Named<string>[];
  spacing: Named<number>[];
  radius: Named<number>[];
  elevation: Shadow[];
  duration: Named<number>[];
  easing: Named<[number, number, number, number]>[];
  focus: Named<number>[];
  tv: Named<number>[];
  layout: Named<number>[];
}

type Node = Record<string, any>;

export const TOKENS_URL = new URL('../tokens/fanous.tokens.json', import.meta.url);

const entries = (group: Node) => Object.entries(group).filter(([k]) => !k.startsWith('$')) as [string, Node][];

function lookup(root: Node, ref: string): Node {
  let node: any = root;
  for (const part of ref.split('.')) {
    node = node?.[part];
    if (node === undefined) throw new Error(`Unresolved token alias {${ref}}`);
  }
  return node;
}

function resolve(root: Node, value: unknown, seen: string[] = []): any {
  if (typeof value !== 'string' || !/^\{.+\}$/.test(value)) return value;
  const ref = value.slice(1, -1);
  if (seen.includes(ref)) throw new Error(`Circular token alias: ${[...seen, ref].join(' -> ')}`);
  return resolve(root, lookup(root, ref).$value, [...seen, ref]);
}

function px(value: unknown): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value));
  if (!match) throw new Error(`Expected a px dimension, got ${value}`);
  return Number(match[1]);
}

function ms(value: unknown): number {
  const match = /^(\d+)ms$/.exec(String(value));
  if (!match) throw new Error(`Expected a ms duration, got ${value}`);
  return Number(match[1]);
}

function hex(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${where}: expected #rrggbb, got ${value}`);
  return value;
}

function named<T>(group: Node, map: (v: unknown) => T): Named<T>[] {
  return entries(group).map(([name, t]) => ({ name, value: map(t.$value), ...(t.$description ? { description: t.$description } : {}) }));
}

const ROLES: Role[] = ['surface', 'fill', 'text', 'on', 'nontext', 'decorative'];

function theme(root: Node, group: Node, label: string): ThemeColor[] {
  return entries(group).map(([name, t]) => {
    const meta = t.$extensions?.fanous;
    if (!ROLES.includes(meta?.role)) throw new Error(`color.theme.${label}.${name} has no valid contrast role`);
    return {
      name,
      hex: hex(resolve(root, t.$value), `color.theme.${label}.${name}`),
      role: meta.role,
      ...(meta.on ? { on: meta.on } : {}),
      ...(t.$description ? { description: t.$description } : {}),
    };
  });
}

function styles(group: Node): TextStyle[] {
  return entries(group).map(([name, t]) => ({
    name,
    size: px(t.$value.fontSize),
    weight: t.$value.fontWeight,
    lineHeight: t.$value.lineHeight,
    letterSpacing: px(t.$value.letterSpacing),
  }));
}

export function buildModel(root: Node): Model {
  const color = root.color;
  const pairs = entries(root.font.pair);
  const activeRef = String(root.font.family.latin.$value).slice(1, -1).split('.')[2];
  return {
    brand: named(color.brand, (v) => hex(resolve(root, v), 'color.brand')),
    derived: named(color.derived, (v) => hex(resolve(root, v), 'color.derived')),
    themes: { dark: theme(root, color.theme.dark, 'dark'), light: theme(root, color.theme.light, 'light') },
    fontPairs: pairs.map(([name, p]) => ({ name, latin: p.latin.$value, arabic: p.arabic.$value })),
    activePair: activeRef,
    typography: { latin: styles(root.typography.latin), arabic: styles(root.typography.arabic) },
    numerals: named(root.numerals, String),
    spacing: named(root.spacing, px),
    radius: named(root.radius, px),
    elevation: entries(root.elevation).map(([name, t]) => ({
      name,
      hex: String(t.$value.color).slice(0, 7),
      alpha: Math.round((parseInt(String(t.$value.color).slice(7), 16) / 255) * 100) / 100,
      x: px(t.$value.offsetX),
      y: px(t.$value.offsetY),
      blur: px(t.$value.blur),
      spread: px(t.$value.spread),
    })),
    duration: named(root.motion.duration, ms),
    easing: named(root.motion.easing, (v) => v as [number, number, number, number]),
    focus: named(root.focus, px),
    tv: named(root.tv, px),
    layout: named(root.layout, px),
  };
}

// Shared naming and number helpers for the generators.
export const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
export const snake = (s: string) => kebab(s).replace(/-/g, '_');
export const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);
export const HEADER = 'Generated by @al-ummah/fanous-tokens from tokens/fanous.tokens.json. Do not edit.';

export function rgb(hexColor: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16)) as [number, number, number];
}
export const unit = (channel: number) => String(Math.round((channel / 255) * 10000) / 10000);
