// Contact sheet: each app's crop at 512/180/64/32/16 (real pixels), then light and dark tab bars.
import { APP_IDS, APPS } from './crop.ts';
import { downscale, svgWrap } from './build.ts';

const uri = (b: Uint8Array, type = 'image/png') => `data:${type};base64,${Buffer.from(b).toString('base64')}`;

export async function contactSheet(): Promise<string> {
  const rows: string[] = [];
  const tabs = { light: [] as string[], dark: [] as string[], qa: [] as string[] };
  for (const app of APP_IDS) {
    const sizes = await Promise.all([512, 180, 64, 32, 16].map(async (s) => ({ s, src: uri(await downscale(app, s)) })));
    rows.push(`<div class="row"><h3>${APPS[app].short}</h3>${sizes.map(({ s, src }) => `<figure><img src="${src}" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('')}</div>`);
    const s16 = sizes.find((x) => x.s === 16)!.src;
    const tab = (src: string) => `<div class="tab"><img src="${src}" width="16" height="16"><span>${APPS[app].short}</span></div>`;
    tabs.light.push(tab(s16));
    tabs.dark.push(tab(s16));
    tabs.qa.push(tab(uri(new TextEncoder().encode(svgWrap(await downscale(app, 64), 'qa')), 'image/svg+xml')));
  }
  return `<!doctype html><meta charset="utf-8"><title>Al Ummah Now icons</title><style>
body{margin:0;font:13px -apple-system,system-ui,sans-serif;background:#fff;color:#1f1f1f;width:1420px;padding-bottom:20px}
h1{font-size:18px;margin:18px 20px}h2{font-size:15px;margin:20px 20px 8px}h3{width:130px;font-size:13px;margin:0}
.row{display:flex;gap:18px;align-items:end;margin:10px 20px;padding-bottom:10px;border-bottom:1px solid #eee}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}figcaption{font-size:11px;color:#666}
.bar{display:flex;gap:2px;padding:6px 8px 0;margin:0 20px}.bar.light{background:#dee1e6}.bar.dark{background:#1f1f1f}
.tab{display:flex;align-items:center;gap:8px;padding:8px 10px;width:150px;border-radius:8px 8px 0 0;font-size:12px;white-space:nowrap}
.light .tab{background:#fff}.light .tab:nth-child(odd){background:#eef0f3}.dark .tab{background:#3c3c3c;color:#e8e8e8}.dark .tab:nth-child(odd){background:#2a2a2a}
</style>
<h1>Al Ummah Now icons: the owner's art, cropped square and downscaled (no edits)</h1>
${rows.join('\n')}
<h2>Tab bars at 16 px: light, dark, and QA (corner dot, light)</h2>
<div class="bar light">${tabs.light.join('')}</div><div class="bar dark">${tabs.dark.join('')}</div><div class="bar light">${tabs.qa.join('')}</div>
`;
}
