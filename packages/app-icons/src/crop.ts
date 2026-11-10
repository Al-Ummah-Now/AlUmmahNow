// The owner's icon art (Magnific renders, and the logo for www), cropped to full-bleed squares.
// Nothing is drawn or recoloured: each source is only cropped, and every size is a downscale.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export const APP_IDS = ['www', 'videos', 'auth', 'profile', 'videos-admin', 'cms', 'auth-admin', 'tools'] as const;
export type AppId = (typeof APP_IDS)[number];

export const APPS: Record<AppId, { name: string; short: string }> = {
  www: { name: 'Al Ummah Now', short: 'Al Ummah Now' },
  videos: { name: 'Al Ummah Now Videos', short: 'Videos' },
  auth: { name: 'Al Ummah Now Sign in', short: 'Sign in' },
  profile: { name: 'Al Ummah Now Account', short: 'Account' },
  'videos-admin': { name: 'Al Ummah Now Videos Admin', short: 'Videos Admin' },
  cms: { name: 'Al Ummah Now CMS', short: 'CMS' },
  'auth-admin': { name: 'Al Ummah Now Accounts Admin', short: 'Accounts Admin' },
  tools: { name: 'Al Ummah Now Tools', short: 'Tools' },
};

/** The owner's choice (2026-11-10): source file per app in the candidates folder. */
export const MAPPING: Record<AppId, string> = {
  www: 'logo', // AlUmmahNowUI public/brand/alummah-now-logo.png
  videos: 'setC-videos-magnific-v1.png',
  auth: 'setC-signin-keyhole.png',
  profile: 'setC-account-flat-silhouette.png',
  cms: 'setC-cms-qalam.png',
  'videos-admin': 'setC-staff-ring-octagon.png',
  'auth-admin': 'setC-staff-double-octagon.png',
  tools: 'setC-staff-ring-octagon.png',
};

/** Other names the owner may use for an app in a file name (setC-<name>-*.png). */
const ALIASES: Record<string, AppId> = {
  signin: 'auth', 'sign-in': 'auth', account: 'profile', 'accounts-admin': 'auth-admin', 'account-admin': 'auth-admin',
};

/** setC-<app>-*: longest id or alias first, so "videos-admin" never matches "videos". */
export function appOfName(name: string): AppId | undefined {
  const lower = name.toLowerCase();
  const keys = [...APP_IDS.map((id) => [id, id] as const), ...Object.entries(ALIASES)].sort((a, b) => b[0].length - a[0].length);
  return keys.find(([key]) => lower.startsWith(`setc-${key}-`) || lower.startsWith(`setc-${key}.`))?.[1];
}

/**
 * Source per app: the mapping, unless the folder has a newer file named for that app
 * (setC-<app>-*), which replaces it.
 */
export function sourcesIn(dir: string): Record<AppId, string> {
  const files = readdirSync(dir).filter((n) => /^setC-.+\.(png|jpe?g|webp)$/i.test(n));
  const mtime = (n: string) => statSync(join(dir, n)).mtimeMs;
  const out = {} as Record<AppId, string>;
  for (const app of APP_IDS) {
    const mapped = MAPPING[app];
    const named = files.filter((n) => appOfName(n) === app && n !== mapped).sort((a, b) => mtime(b) - mtime(a))[0];
    const mappedTime = mapped !== 'logo' && files.includes(mapped) ? mtime(mapped) : 0;
    out[app] = named && mtime(named) > mappedTime ? named : mapped;
  }
  return out;
}

/** First strong luminance edge along a scan line from the outside. */
function firstEdge(get: (k: number) => number, len: number): number | undefined {
  for (let k = 2; k < len; k++) if (Math.abs(get(k) - get(k - 2)) > 28) return k;
  return undefined;
}

/**
 * Crop box of the art inside a baked-in frame. Magnific renders a rounded, often bevelled tile
 * centred on a wider canvas. The tile's outer square comes from its nearest edges; then each
 * corner is walked along the diagonal to where the frame's band of edges ends, and the square is
 * inset by that (second-largest corner, so a line in the art near one corner doesn't count) so
 * no frame is left. A square image without a frame is kept whole.
 */
export async function cropBox(file: string): Promise<{ left: number; top: number; size: number; frame: boolean }> {
  const { data, info } = await sharp(file).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (x: number, y: number) => data[y * W + x];
  const cx = W >> 1, cy = H >> 1;
  const edges = [
    firstEdge((k) => at(k, cy), cx), firstEdge((k) => at(W - 1 - k, cy), cx),
    firstEdge((k) => at(cx, k), cy), firstEdge((k) => at(cx, H - 1 - k), cy),
  ];
  if (W === H || !edges.every((e) => e !== undefined && e > 8)) {
    const size = Math.min(W, H);
    return { left: (W - size) >> 1, top: (H - size) >> 1, size, frame: false };
  }
  const [l, r, t, b] = edges as number[];
  const half = Math.min(cx - Math.min(l, r), cy - Math.min(t, b));
  const x0 = cx - half, y0 = cy - half, outer = 2 * half;
  // along each corner's diagonal: the end of the first band of edges (gaps under 4% of the tile)
  const corner = (fromLeft: boolean, fromTop: boolean) => {
    const px = (k: number) => at(x0 + (fromLeft ? k : outer - 1 - k), y0 + (fromTop ? k : outer - 1 - k));
    let last: number | undefined;
    for (let k = 2; k < outer * 0.3; k++) {
      if (Math.abs(px(k) - px(k - 2)) <= 24) continue;
      if (last !== undefined && k - last > outer * 0.04) break;
      last = k;
    }
    return last ?? 0;
  };
  const insets = [corner(true, true), corner(false, true), corner(true, false), corner(false, false)].sort((p, q) => q - p);
  const inset = insets[1] + 4;
  const size = outer - 2 * inset;
  return { left: x0 + inset, top: y0 + inset, size, frame: true };
}

/** The logo: its round photo's bounding square (transparent outside the circle). */
export async function logoCrop(file: string): Promise<Buffer> {
  // trim the transparent margin, then centre on a transparent square (the photo is round)
  const trimmed = await sharp(file).trim({ threshold: 0 }).png().toBuffer();
  const { width = 0, height = 0 } = await sharp(trimmed).metadata();
  const size = Math.max(width, height);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed, left: (size - width) >> 1, top: (size - height) >> 1 }]).png().toBuffer();
}

export async function cropFile(file: string): Promise<Buffer> {
  const box = await cropBox(file);
  return sharp(file).extract({ left: box.left, top: box.top, width: box.size, height: box.size }).png().toBuffer();
}
