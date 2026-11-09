// Converts the theme SVGs (already resolved to fixed colours) into Android VectorDrawables. Covers the subset
// the theme assets use: path, circle, ellipse, rect, line, groups with translate/scale/rotate, opacity,
// fill and stroke, radial gradients and clip paths. Anything else fails, so a new asset cannot slip through.

interface El { name: string; attrs: Record<string, string>; children: El[] }

export function parseXml(text: string): El {
  const root: El = { name: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    const [, close, name, attrText, self] = m;
    if (close) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`unbalanced </${name}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el: El = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  if (stack.length !== 1) throw new Error('unclosed element');
  const svg = root.children.find((c) => c.name === 'svg');
  if (!svg) throw new Error('no <svg> root');
  return svg;
}

const n = (v: string | undefined, d = 0) => (v === undefined ? d : Number(v));
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

interface Paint { fill?: string; stroke?: string; strokeWidth?: number; opacity: number }

function argb(color: string, alpha: number): string {
  const c = color.trim().toLowerCase();
  const named: Record<string, string> = { black: '#000000', white: '#ffffff' };
  const hex = named[c] ?? c;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(hex);
  if (!m) throw new Error(`unsupported colour "${color}"`);
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${a}${h}`.toUpperCase();
}

function shapePath(el: El): string | undefined {
  const a = el.attrs;
  switch (el.name) {
    case 'path': return a.d;
    case 'circle': case 'ellipse': {
      const cx = n(a.cx); const cy = n(a.cy);
      const rx = el.name === 'circle' ? n(a.r) : n(a.rx); const ry = el.name === 'circle' ? n(a.r) : n(a.ry);
      return `M${fmt(cx - rx)},${fmt(cy)}A${fmt(rx)},${fmt(ry)} 0 1,0 ${fmt(cx + rx)},${fmt(cy)}A${fmt(rx)},${fmt(ry)} 0 1,0 ${fmt(cx - rx)},${fmt(cy)}Z`;
    }
    case 'rect': {
      const x = n(a.x); const y = n(a.y); const w = n(a.width); const h = n(a.height);
      return `M${fmt(x)},${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`;
    }
    case 'line': return `M${fmt(n(a.x1))},${fmt(n(a.y1))}L${fmt(n(a.x2))},${fmt(n(a.y2))}`;
    default: return undefined;
  }
}

/** Bounding box of a shape, for objectBoundingBox gradients. Paths use their points, which bound the curve hull. */
function bbox(el: El): [number, number, number, number] {
  const a = el.attrs;
  if (el.name === 'circle') return [n(a.cx) - n(a.r), n(a.cy) - n(a.r), 2 * n(a.r), 2 * n(a.r)];
  if (el.name === 'ellipse') return [n(a.cx) - n(a.rx), n(a.cy) - n(a.ry), 2 * n(a.rx), 2 * n(a.ry)];
  if (el.name === 'rect') return [n(a.x), n(a.y), n(a.width), n(a.height)];
  const d = shapePath(el) ?? '';
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e-?\d+)?/g)].map((x) => Number(x[0]));
  const xs: number[] = []; const ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

function transforms(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)].map((m) => {
    const v = m[2].trim().split(/[\s,]+/).map(Number);
    if (m[1] === 'translate') return `android:translateX="${fmt(v[0])}" android:translateY="${fmt(v[1] ?? 0)}"`;
    if (m[1] === 'scale') return `android:scaleX="${fmt(v[0])}" android:scaleY="${fmt(v[1] ?? v[0])}"`;
    return `android:rotation="${fmt(v[0])}" android:pivotX="${fmt(v[1] ?? 0)}" android:pivotY="${fmt(v[2] ?? 0)}"`;
  });
}

export function svgToVector(svgText: string, where: string): string {
  try {
    const svg = parseXml(svgText);
    const [vx, vy, vw, vh] = (svg.attrs.viewBox ?? `0 0 ${svg.attrs.width} ${svg.attrs.height}`).split(/[\s,]+/).map(Number);
    if (vx !== 0 || vy !== 0) throw new Error('viewBox must start at 0 0');
    const defs = new Map<string, El>();
    const collect = (el: El) => { if (el.attrs.id) defs.set(el.attrs.id, el); el.children.forEach(collect); };
    collect(svg);
    const ref = (v: string | undefined) => (v ? /^url\(#([^)]+)\)$/.exec(v.trim())?.[1] : undefined);

    const gradient = (id: string, el: El, alpha: number) => {
      const g = defs.get(id);
      if (!g || g.name !== 'radialGradient') throw new Error(`fill url(#${id}) is not a radialGradient`);
      const [x, y, w, h] = bbox(el);
      const pct = (v: string | undefined, d: number) => (v === undefined ? d : v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v));
      const cx = x + w * pct(g.attrs.cx, 0.5); const cy = y + h * pct(g.attrs.cy, 0.5); const r = Math.max(w, h) * pct(g.attrs.r, 0.5);
      const items = g.children.filter((s) => s.name === 'stop').map((s) => {
        const color = s.attrs['stop-color'] ?? '#000000';
        return `<item android:offset="${fmt(pct(s.attrs.offset, 0))}" android:color="${argb(color, n(s.attrs['stop-opacity'], 1) * alpha)}"/>`;
      });
      return `<aapt:attr name="android:fillColor"><gradient android:type="radial" android:centerX="${fmt(cx)}" android:centerY="${fmt(cy)}" android:gradientRadius="${fmt(Math.max(r, 0.001))}">${items.join('')}</gradient></aapt:attr>`;
    };

    const walk = (el: El, inherited: Paint): string => {
      const a = el.attrs;
      if (['defs', 'radialGradient', 'clipPath', 'stop', 'title', 'desc'].includes(el.name)) return '';
      const paint: Paint = {
        fill: a.fill ?? inherited.fill,
        stroke: a.stroke ?? inherited.stroke,
        strokeWidth: a['stroke-width'] !== undefined ? Number(a['stroke-width']) : inherited.strokeWidth,
        opacity: inherited.opacity * n(a.opacity, 1),
      };
      let body: string;
      if (el.name === 'g') body = el.children.map((c) => walk(c, paint)).join('');
      else {
        const d = shapePath(el);
        if (d === undefined) throw new Error(`unsupported element <${el.name}>`);
        const attrs = [`android:pathData="${d}"`];
        let inner = '';
        const fill = el.name === 'line' ? 'none' : (paint.fill ?? '#000000');
        const fillRef = ref(fill);
        if (fillRef) inner = gradient(fillRef, el, paint.opacity);
        else if (fill !== 'none') attrs.push(`android:fillColor="${argb(fill, paint.opacity)}"`);
        if (paint.stroke && paint.stroke !== 'none') {
          attrs.push(`android:strokeColor="${argb(paint.stroke, paint.opacity)}"`, `android:strokeWidth="${fmt(paint.strokeWidth ?? 1)}"`);
        }
        body = inner ? `<path ${attrs.join(' ')}>${inner}</path>` : `<path ${attrs.join(' ')}/>`;
      }
      const clip = ref(a['clip-path']);
      if (clip) {
        const c = defs.get(clip);
        if (!c || c.name !== 'clipPath') throw new Error(`clip-path url(#${clip}) is not a clipPath`);
        body = `<group><clip-path android:pathData="${c.children.map((x) => shapePath(x) ?? '').join(' ')}"/>${body}</group>`;
      }
      for (const t of transforms(a.transform).reverse()) body = `<group ${t}>${body}</group>`;
      return body;
    };
    const content = svg.children.map((c) => walk(c, { opacity: 1 })).join('');
    return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by @al-ummah/fanous-tokens (native registry). Do not edit. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${fmt(vw)}dp" android:height="${fmt(vh)}dp" android:viewportWidth="${fmt(vw)}" android:viewportHeight="${fmt(vh)}">
${content}
</vector>
`;
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
}
