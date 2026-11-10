// Contact sheet: every app in light and dark tab bars, QA/stage markers, 1x pixels, 32/64 px and
// an iOS home screen. Open the HTML in a browser (or screenshot it) to review a change.
import { rasterise } from './build.ts';
import { APP_IDS, APPS, bleedSvg, faviconSvg, type Env, type Scheme } from './marks.ts';

const uri = async (svg: string, px: number) => `data:image/png;base64,${Buffer.from(await rasterise(svg, px)).toString('base64')}`;
const all = <T>(f: (id: (typeof APP_IDS)[number]) => Promise<T>) => Promise.all(APP_IDS.map(f));

export async function contactSheet(): Promise<string> {
  const tabs = async (scheme: Scheme, env: Env = 'prod') => (await all(async (id) =>
    `<div class="tab"><img src="${await uri(faviconSvg(id, { scheme, env }), 32)}" width="16" height="16"><span>${APPS[id].short}</span></div>`)).join('');
  const px = async (scheme: Scheme) => (await all(async (id) =>
    `<img class="px" src="${await uri(faviconSvg(id, { scheme }), 16)}" width="32" height="32">`)).join('');
  const big = async (scheme: Scheme) => (await all(async (id) =>
    `<figure><img src="${await uri(faviconSvg(id, { scheme }), 64)}" width="32" height="32"><img src="${await uri(faviconSvg(id, { scheme }), 128)}" width="64" height="64"><figcaption>${id}</figcaption></figure>`)).join('');
  const home = (await all(async (id) =>
    `<figure class="app"><img src="${await uri(bleedSvg(id, 0.62), 180)}" width="60" height="60"><figcaption>${APPS[id].short}</figcaption></figure>`)).join('');
  return `<!doctype html><meta charset="utf-8"><title>Al Ummah Now favicons</title><style>
body{margin:0;font:13px -apple-system,system-ui,sans-serif;background:#fff;color:#222;width:1180px}
h2{font-size:14px;margin:18px 20px 8px}
.bar{display:flex;gap:2px;padding:6px 8px 0}.bar.light{background:#dee1e6}.bar.dark{background:#1f1f1f}
.tab{display:flex;align-items:center;gap:8px;padding:8px 10px;width:150px;border-radius:8px 8px 0 0;font-size:12px;white-space:nowrap;overflow:hidden}
.light .tab{background:#fff;color:#1f1f1f}.light .tab:nth-child(odd){background:#eef0f3}
.dark .tab{background:#3c3c3c;color:#e8e8e8}.dark .tab:nth-child(odd){background:#2a2a2a}
.row{display:flex;gap:22px;padding:12px 20px;align-items:end}.row.dk{background:#202124;color:#ddd}
.px{margin:0 6px;image-rendering:pixelated}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}figcaption{font-size:11px}
.home{display:grid;grid-template-columns:repeat(7,90px);gap:18px;padding:30px 40px;background:linear-gradient(160deg,#0b3443,#3c2a52 60%,#7a4a2a);border-radius:30px;margin:10px 20px 20px;width:max-content}
.app img{border-radius:14px;box-shadow:0 2px 6px #0005}.app figcaption{color:#fff}
</style>
<h2>Light tab bar, 16 px</h2><div class="bar light">${await tabs('light')}</div>
<h2>Dark tab bar, 16 px</h2><div class="bar dark">${await tabs('dark')}</div>
<h2>QA (violet dot, light) and stage (pink dot, dark)</h2><div class="bar light">${await tabs('light', 'qa')}</div><div class="bar dark">${await tabs('dark', 'stage')}</div>
<h2>16 px at 1x, enlarged 2x: light, then dark</h2><div class="row">${await px('light')}</div><div class="row dk">${await px('dark')}</div>
<h2>32 px and 64 px</h2><div class="row">${await big('light')}</div><div class="row dk">${await big('dark')}</div>
<h2>iOS home screen (apple-touch-icon.png, 180 px)</h2><div class="home">${home}</div>
`;
}
