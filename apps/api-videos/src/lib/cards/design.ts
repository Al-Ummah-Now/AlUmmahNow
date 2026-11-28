import { z } from 'zod';
import type { CardCopy } from './source';
import { cardTypeSize } from './paginate';

const palettes = {
  fawanees: [
    ['#10162c', '#242445', '#ffeec8', '#e2b96f'],
    ['#171224', '#36213d', '#fff1d2', '#f0bb83'],
  ],
  folio: [
    ['#f5e8ce', '#dfc59b', '#342719', '#80522b'],
    ['#dfebdd', '#bccfb7', '#213528', '#315d48'],
  ],
  editorial: [
    ['#181b2f', '#302848', '#f9f0ff', '#ecbafb'],
    ['#122b2d', '#1d4241', '#edf8e8', '#a6ddb9'],
  ],
} as const;

export const cardDesignSchema = z.strictObject({
  template: z.enum(['fawanees', 'folio', 'editorial']),
  palette: z.int().min(0).max(1),
  format: z.enum(['square', 'portrait']),
});

export type CardDesign = z.infer<typeof cardDesignSchema>;
export type CardFonts = { amiri: string; sourceSerif: string };

const styles = {
  fawanees: `
    main { text-align:center; padding:190px 135px 112px; }
    main::before { position:absolute; inset:74px 58px 57px; content:""; border:2px solid var(--accent);
      border-radius:48% 48% 8px 8px / 23% 23% 8px 8px; box-shadow:0 0 70px #0004,inset 0 0 70px #0004; }
    main::after { position:absolute; inset-block-start:121px; inset-inline-start:calc(50% - 16px);
      content:""; width:28px; height:28px; border:2px solid var(--accent); transform:rotate(45deg); }
    footer { border-top:1px solid var(--accent); padding-top:22px; }
  `,
  folio: `
    main { padding:115px 105px; }
    main::before { position:absolute; inset:57px; content:""; border:1px solid var(--accent); }
    blockquote { border-inline-start:6px double var(--accent); padding-inline-start:32px; }
    footer { background:var(--panel); padding:22px 26px; border-block-start:2px solid var(--accent); }
  `,
  editorial: `
    main { padding:92px 80px; }
    main::before { position:absolute; inset:0; content:""; background:linear-gradient(156deg, transparent 56%, var(--panel) 56%); }
    blockquote { padding-block-start:38px; border-block-start:8px solid var(--accent); }
    footer { align-self:end; max-width:78%; border-inline-start:4px solid var(--accent); padding-inline-start:24px; }
  `,
};

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
  ));
}

export function cardDimensions(format: CardDesign['format']) {
  return { width: 1080, height: format === 'portrait' ? 1350 : 1080 };
}

/** Self-contained document shared by Chromium capture and the sandboxed composer preview. */
export function cardDocument(copy: CardCopy, design: CardDesign, locale: 'en' | 'ar', fonts: CardFonts): string {
  const { width, height } = cardDimensions(design.format);
  const [background, panel, foreground, accent] = palettes[design.template][design.palette];
  // The only font inputs are trusted base64-encoded WOFF2 assets.
  for (const font of Object.values(fonts)) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(font)) throw new Error('Invalid card font asset');
  }
  return `<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
@font-face { font-family:Amiri; src:url(data:font/woff2;base64,${fonts.amiri}) format('woff2'); }
@font-face { font-family:SourceSerif; src:url(data:font/woff2;base64,${fonts.sourceSerif}) format('woff2'); }
* { box-sizing:border-box; }
html { margin:0; color:${foreground}; background:${background}; }
body { margin:0; width:${width}px; height:${height}px; font-family:SourceSerif,Amiri,serif; }
main { --accent:${accent}; --panel:${panel}; position:relative; width:100%; height:100%;
  display:grid; grid-template-rows:minmax(0,1fr) auto; gap:30px;
  background:radial-gradient(ellipse at 50% 28%, var(--panel), transparent 72%); }
blockquote, footer { z-index:1; margin:0; min-width:0; overflow-wrap:anywhere; white-space:pre-wrap; }
blockquote { align-self:stretch; display:grid; align-content:center; font-size:${cardTypeSize[design.format]}px; line-height:1.42; }
blockquote:has(> bdi:dir(rtl)) { line-height:1.86; }
bdi:dir(rtl) { font-family:Amiri,SourceSerif,serif; }
footer { font-size:29px; line-height:1.38; }
footer .page { float:inline-end; margin-inline-start:12px; color:var(--accent); }
footer small { display:block; font-size:.82em; margin-top:7px; }
${styles[design.template]}
</style>
<main><blockquote><bdi dir="auto">${escape(copy.text)}</bdi></blockquote><footer>${copy.pageLabel ? `<bdi class="page" dir="ltr">${escape(copy.pageLabel)}</bdi>` : ''}<bdi dir="auto">${escape(copy.citation)}</bdi>${copy.credit ? `<small><bdi dir="auto">${escape(copy.credit)}</bdi></small>` : ''}</footer></main>
<script>
(async () => {
  await Promise.all([document.fonts.load('32px Amiri', 'ع'), document.fonts.load('32px SourceSerif', 'A')]);
  await document.fonts.ready;
  const body = document.querySelector('blockquote');
  const footer = document.querySelector('footer');
  if (body.scrollHeight <= body.clientHeight && footer.getBoundingClientRect().bottom <= ${height} - 50) {
    document.documentElement.dataset.cardReady = 'true';
    return;
  }
  document.documentElement.dataset.cardReady = 'overflow';
})().catch(() => { document.documentElement.dataset.cardReady = 'font-error'; });
</script></html>`;
}
