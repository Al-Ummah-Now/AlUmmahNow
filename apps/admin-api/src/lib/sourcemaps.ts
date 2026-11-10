/**
 * Symbolication of browser stacks with the private source maps the release
 * uploads to R2 (bucket bound as SOURCEMAPS):
 *
 *   <app>/<release>/_next/static/chunks/<file>.js.map
 *
 * The maps are removed from the deployed assets, so only admin-api can read
 * them. Without a map (local builds, maps not uploaded) the raw stack is kept.
 */
import type { StackFrame } from '@al-ummah/shared-types';

export interface SourceMapBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

interface RawSourceMap {
  version: number;
  sources: string[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
  sections?: unknown[];
}

/** One generated line: [generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex?] per segment. */
type Segment = [number, number, number, number, number?];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map(Array.from(B64).map((c, i) => [c, i]));

/** Decodes Base64 VLQ values of one segment. */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64_INDEX.get(ch);
    if (digit === undefined) throw new Error(`bad VLQ char ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

export class ParsedSourceMap {
  private lines: Segment[][] | null = null;
  constructor(private readonly map: RawSourceMap) {}

  static parse(text: string): ParsedSourceMap | null {
    try {
      const map = JSON.parse(text) as RawSourceMap;
      if (map.version !== 3 || typeof map.mappings !== 'string' || !Array.isArray(map.sources)) return null;
      return new ParsedSourceMap(map);
    } catch {
      return null;
    }
  }

  private decode(): Segment[][] {
    if (this.lines) return this.lines;
    const lines: Segment[][] = [];
    let src = 0;
    let oLine = 0;
    let oCol = 0;
    let name = 0;
    for (const lineText of this.map.mappings.split(';')) {
      const segs: Segment[] = [];
      let gCol = 0;
      if (lineText) {
        for (const segText of lineText.split(',')) {
          if (!segText) continue;
          const v = decodeVlq(segText);
          gCol += v[0];
          if (v.length >= 4) {
            src += v[1];
            oLine += v[2];
            oCol += v[3];
            if (v.length >= 5) {
              name += v[4];
              segs.push([gCol, src, oLine, oCol, name]);
            } else segs.push([gCol, src, oLine, oCol]);
          }
        }
      }
      segs.sort((a, b) => a[0] - b[0]);
      lines.push(segs);
    }
    this.lines = lines;
    return lines;
  }

  /** Original position of a 1-based line / 1-based column (as in stack traces). */
  lookup(line: number, column: number): { source: string; line: number; column: number; name?: string } | null {
    const segs = this.decode()[line - 1];
    if (!segs || segs.length === 0) return null;
    const col = column - 1;
    let lo = 0;
    let hi = segs.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid][0] <= col) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const s = segs[found];
    const source = cleanSource(`${this.map.sourceRoot ?? ''}${this.map.sources[s[1]] ?? ''}`);
    return { source, line: s[2] + 1, column: s[3] + 1, name: s[4] !== undefined ? this.map.names?.[s[4]] : undefined };
  }
}

/** "webpack://_N_E/./src/components/x.tsx?abc" → "src/components/x.tsx" */
export function cleanSource(source: string): string {
  return source
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^\.\//, '')
    .replace(/^\(app-pages-browser\)\/\.?\/?/, '')
    .replace(/\?.*$/, '');
}

/** R2 key of the map for a frame's file, or null when the frame is not one of our static chunks. */
export function sourceMapKey(app: string, release: string, file: string): string | null {
  const m = /\/_next\/static\/(.+?\.js)(?:[?#].*)?$/.exec(file);
  if (!m || !/^[A-Za-z0-9._-]{1,80}$/.test(release)) return null;
  if (m[1].includes('..')) return null;
  return `${app}/${release}/_next/static/${m[1]}.map`;
}

/** Small per-isolate cache: a release's maps are reused across many events. */
const cache = new Map<string, ParsedSourceMap | null>();
const CACHE_MAX = 12;
const MAX_MAP_BYTES = 25 * 1024 * 1024;

export function clearSourceMapCache(): void {
  cache.clear();
}

async function loadMap(bucket: SourceMapBucket, key: string): Promise<ParsedSourceMap | null> {
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let parsed: ParsedSourceMap | null = null;
  try {
    const obj = await bucket.get(key);
    if (obj) {
      const text = await obj.text();
      if (text.length <= MAX_MAP_BYTES) parsed = ParsedSourceMap.parse(text);
    }
  } catch {
    parsed = null;
  }
  cache.set(key, parsed);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return parsed;
}

/**
 * Maps the first frames of a browser stack to original sources. Returns null
 * when no frame could be mapped (keep the raw stack).
 */
export async function symbolicateFrames(bucket: SourceMapBucket | undefined, app: string, release: string | undefined, frames: StackFrame[], maxFrames = 12): Promise<StackFrame[] | null> {
  if (!bucket || !release || frames.length === 0) return null;
  let mapped = 0;
  const out: StackFrame[] = [];
  for (const [i, f] of frames.entries()) {
    if (i >= maxFrames || !f.line || !f.column) {
      out.push(f);
      continue;
    }
    const key = sourceMapKey(app, release, f.file);
    const map = key ? await loadMap(bucket, key) : null;
    const pos = map?.lookup(f.line, f.column);
    if (!pos || !pos.source) {
      out.push(f);
      continue;
    }
    mapped += 1;
    out.push({ fn: pos.name || f.fn, file: pos.source, line: pos.line, column: pos.column });
  }
  return mapped > 0 ? out : null;
}

export function formatFrames(name: string | undefined, message: string, frames: StackFrame[]): string {
  return [`${name || 'Error'}: ${message}`, ...frames.map((f) => `    at ${f.fn} (${f.file}${f.line ? `:${f.line}` : ''}${f.column ? `:${f.column}` : ''})`)].join('\n');
}
