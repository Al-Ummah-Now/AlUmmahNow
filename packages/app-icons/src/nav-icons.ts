/**
 * The account menu's "Al Ummah Now apps" icons (AlUmmahNow docs/design/NAV.md): each app's own
 * favicon, the owner's art as is. It is the exact 48 px PNG every app serves as favicon-48x48.png
 * (the same `downscale` call, byte for byte), shown at 24 px in the menu (2x) and 48 px on the
 * profile app's "Your apps" cards (1x). Nothing is drawn, recoloured or badged. The PNGs are
 * embedded in the shared nav stylesheet, so every app shows the same icons with no extra request
 * and no cross-origin image.
 *
 *   node --experimental-strip-types src/nav-icons.ts          rewrite the block in aun-nav.css
 *   node --experimental-strip-types src/nav-icons.ts --check  fail when the block is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
/** The favicon size used: the exact favicon-48x48.png of each app. */
export const NAV_ICON_SIZE = 48;
const CSS = join(import.meta.dirname, '../../fanous-tokens/nav/aun-nav.css');
const START = '/* @generated app icons (packages/app-icons src/nav-icons.ts): do not edit */';
const END = '/* @end app icons */';

export async function navIconsBlock(): Promise<string> {
  const rules: string[] = [];
  for (const [id, app] of Object.entries(NAV_APPS)) {
    const png = Buffer.from(await downscale(app, NAV_ICON_SIZE));
    rules.push(`.aun-app-icon[data-app='${id}'] {\n  background-image: url('data:image/png;base64,${png.toString('base64')}');\n}`);
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
