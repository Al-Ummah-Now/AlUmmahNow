/**
 * The account menu's "Al Ummah Now apps" icons (AlUmmahNow docs/design/NAV.md): each app's own
 * favicon, the owner's art as is, whole. The source is the app's highest-resolution favicon asset,
 * the 512 px crop every app serves as icon-512.png; it is downscaled (Lanczos, the same `downscale`
 * as every favicon size) to 96 px and stored as lossless WebP (every visible pixel identical to the
 * PNG). The menus show it in a circle at 2rem (3x) and the profile app's "Your apps" cards at 3rem
 * (2x). Nothing is drawn, recoloured or badged.
 *
 * The images are separate static files, never inlined in the stylesheet (that made every page's
 * render-blocking CSS 120 KB): `packages/fanous-tokens/nav/icons/<id>.webp`, which the vendoring
 * repos fetch with the stylesheet and serve at `/aun-nav/icons/<id>.webp`, and copies in the
 * videos web and admin `public/` folders. Menus load them lazily with their size set.
 *
 *   node --experimental-strip-types src/nav-icons.ts          write the files
 *   node --experimental-strip-types src/nav-icons.ts --check  fail when any copy differs from icon-512
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { downscale } from './build.ts';
import type { AppId } from './crop.ts';

/** Menu ids (packages/shared-types app-links AppLinkId) → icon set. */
export const NAV_APPS: Record<string, AppId> = {
  www: 'www',
  videos: 'videos',
  profile: 'profile',
  cms: 'cms',
  admin: 'videos-admin',
  'auth-admin': 'auth-admin',
};
/** Size: 3x the 2rem menu circle, 2x the 3rem profile card. */
export const NAV_ICON_SIZE = 96;
/** Served path in every app. */
export const navIconPath = (id: string) => `/aun-nav/icons/${id}.webp`;

const ROOT = join(import.meta.dirname, '../../..');
/** The canonical files (vendored by the other repos) and the copies the Next apps serve. */
export const NAV_ICON_DIRS = [
  'packages/fanous-tokens/nav/icons',
  'apps/web/public/aun-nav/icons',
  'apps/admin-web/public/aun-nav/icons',
];

/** One app's icon: its icon-512 crop downscaled to 96 px, lossless WebP. */
export async function navIcon(app: AppId): Promise<Buffer> {
  // Lossless: every visible pixel equals the PNG; only fully transparent ones (the www logo's corners) may differ
  return sharp(Buffer.from(await downscale(app, NAV_ICON_SIZE))).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
}

async function main() {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const [id, app] of Object.entries(NAV_APPS)) {
    const icon = await navIcon(app);
    for (const dir of NAV_ICON_DIRS) {
      const file = join(ROOT, dir, `${id}.webp`);
      if (check) {
        let current: Buffer | undefined;
        try {
          current = readFileSync(file);
        } catch {
          current = undefined;
        }
        if (!current?.equals(icon)) stale.push(join(dir, `${id}.webp`));
      } else {
        mkdirSync(join(ROOT, dir), { recursive: true });
        writeFileSync(file, icon);
      }
    }
  }
  if (check && stale.length) {
    console.error(`nav icons differ from the apps' icon-512 crops:\n  ${stale.join('\n  ')}\nRun: pnpm --filter @al-ummah/app-icons nav-icons`);
    process.exit(1);
  }
  console.info(check ? 'nav icons match the icon-512 crops' : `wrote the nav icons to ${NAV_ICON_DIRS.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
