/**
 * The account menu's "Al Ummah Now apps" icons (AlUmmahNow docs/design/NAV.md): each app's own
 * favicon, the owner's art as is, whole. The source is the app's highest-resolution favicon asset,
 * the 512 px crop every app serves as icon-512.png; it is downscaled (Lanczos, the same `downscale`
 * as every favicon size) to 96 px and stored as lossless WebP (every visible pixel identical to the
 * PNG). The stylesheet shows the whole square inside a circle: 2rem in the menu, like the account
 * avatars (3x), and 3rem on the profile app's "Your apps" cards (2x). Nothing is drawn, recoloured
 * or badged. The images are embedded in the shared nav stylesheet, so every app shows the same
 * icons with no extra request and no cross-origin image.
 *
 *   node --experimental-strip-types src/nav-icons.ts          rewrite the block in aun-nav.css
 *   node --experimental-strip-types src/nav-icons.ts --check  fail when the block is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
/** Embedded size: 3x the 2rem menu circle, 2x the 3rem profile card. */
export const NAV_ICON_SIZE = 96;
const CSS = join(import.meta.dirname, '../../fanous-tokens/nav/aun-nav.css');
const START = '/* @generated app icons (packages/app-icons src/nav-icons.ts): do not edit */';
const END = '/* @end app icons */';

export async function navIconsBlock(): Promise<string> {
  const rules: string[] = [];
  for (const [id, app] of Object.entries(NAV_APPS)) {
    // Lossless: every visible pixel equals the PNG; only fully transparent ones (the www logo's corners) may differ
    const webp = await sharp(Buffer.from(await downscale(app, NAV_ICON_SIZE))).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
    rules.push(`.aun-app-icon[data-app='${id}'] {\n  background-image: url('data:image/webp;base64,${webp.toString('base64')}');\n}`);
  }
  return `${START}\n${rules.join('\n')}\n${END}`;
}

async function main() {
  const css = readFileSync(CSS, 'utf8');
  const a = css.indexOf(START);
  const b = css.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`${CSS}: no app-icons block`);
  const next = css.slice(0, a) + (await navIconsBlock()) + css.slice(b + END.length);
  if (process.argv.includes('--check')) {
    if (next !== css) {
      console.error('aun-nav.css app icons are out of date: run pnpm --filter @al-ummah/app-icons nav-icons');
      process.exit(1);
    }
    return;
  }
  writeFileSync(CSS, next);
  console.info('wrote the app icons into', CSS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
