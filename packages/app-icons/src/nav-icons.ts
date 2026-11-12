/**
 * The account menu's "Al Ummah Now apps" icons (AlUmmahNow docs/design/NAV.md): every app's own icon,
 * the owner's art as is (the 512 px crop in assets/crops, one Lanczos downscale to 40 px (2x the 20 px it is shown at), lossless WebP, nothing
 * drawn or recoloured), embedded in the shared nav stylesheet so every app shows the same icons with
 * no cross-origin image or CSP entry.
 *
 *   node --experimental-strip-types src/nav-icons.ts          rewrite the block in aun-nav.css
 *   node --experimental-strip-types src/nav-icons.ts --check  fail when the block is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CROPS } from './build.ts';

/** Menu ids (packages/shared-types app-links AppLinkId) → icon set. */
export const NAV_APPS = { www: 'www', videos: 'videos', profile: 'profile', cms: 'cms', admin: 'videos-admin', 'auth-admin': 'auth-admin' } as const;
const CSS = join(import.meta.dirname, '../../fanous-tokens/nav/aun-nav.css');
const START = '/* @generated app icons (packages/app-icons src/nav-icons.ts): do not edit */';
const END = '/* @end app icons */';

export async function navIconsBlock(): Promise<string> {
  const rules: string[] = [];
  for (const [id, set] of Object.entries(NAV_APPS)) {
    const png = await sharp(join(CROPS, `${set}.webp`)).resize(40, 40, { kernel: 'lanczos3' }).webp({ lossless: true, effort: 6 }).toBuffer();
    rules.push(`.aun-app-icon[data-app='${id}'] {\n  background-image: url('data:image/webp;base64,${png.toString('base64')}');\n}`);
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
      console.error('aun-nav.css app icons are out of date: run node --experimental-strip-types src/nav-icons.ts');
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
