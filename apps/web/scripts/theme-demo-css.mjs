// Prototype only: turns the built theme into CSS for this app's class-based light and dark.
import { readFileSync, writeFileSync } from 'node:fs';
const here = new URL('../src/theme/', import.meta.url);
const css = readFileSync(new URL('active/web/tokens.css', here), 'utf8')
  .replace(/:root,\s*\[data-fanous-theme='dark'\]/, 'html.dark')
  .replace("[data-fanous-theme='light']", 'html:not(.dark)');
writeFileSync(new URL('active.css', here), css);

const FONTS = {
  zujaj: { latin: 'Inter', arabic: 'Noto Kufi Arabic', files: [['Inter', 400, 'inter-latin-400'], ['Inter', 600, 'inter-latin-600'], ['Inter', 700, 'inter-latin-700'], ['Noto Kufi Arabic', 400, 'noto-kufi-arabic-arabic-400'], ['Noto Kufi Arabic', 700, 'noto-kufi-arabic-arabic-700']] },
  nahas: { latin: 'Source Serif 4', arabic: 'Amiri', files: [['Source Serif 4', 400, 'source-serif-4-latin-400'], ['Source Serif 4', 600, 'source-serif-4-latin-600'], ['Source Serif 4', 700, 'source-serif-4-latin-700'], ['Amiri', 400, 'amiri-arabic-400'], ['Amiri', 700, 'amiri-arabic-700']] },
};
const pick = FONTS[process.env.ACTIVE_THEME];
if (pick) {
  const faces = pick.files.map(([f, w, n]) => `@font-face{font-family:'${f}';font-weight:${w};font-display:swap;src:url('/fonts/${n}-normal.woff2') format('woff2')}`).join('');
  writeFileSync(new URL('active.css', here), `${css}\n${faces}\nhtml body,html body *{font-family:'${pick.latin}','${pick.arabic}',system-ui,sans-serif}\nhtml[lang=ar] body,html[lang=ar] body *,[dir=rtl],[dir=rtl] *{font-family:'${pick.arabic}','${pick.latin}',system-ui,sans-serif}\n.video-js .vjs-icon-placeholder,.video-js [class*=vjs-icon],.fa,.fas,.far,.fab,.fa-solid,.fa-regular,[class*=fa-]{font-family:revert-layer}\n`);
}
