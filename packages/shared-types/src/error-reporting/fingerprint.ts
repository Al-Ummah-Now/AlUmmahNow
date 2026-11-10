/**
 * Grouping: events with the same fingerprint are one error group on the
 * admin Errors page. The fingerprint is the app, the error name, the
 * normalised message (numbers, ids, quoted values and URLs replaced), the top
 * stack frames (function + file without build hashes or line numbers, so a
 * new build does not split a group) and the normalised route.
 */

/** FNV-1a over UTF-16 code units, two seeds → 16 hex chars. Sync, so browsers and Workers agree without crypto.subtle. */
export function hash64(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_ID = /\b[a-z]{2,5}_[A-Za-z0-9]{6,}\b/g;
const HEX = /\b(?:0x)?[0-9a-f]{8,}\b/gi;
const URL_RE = /\b(?:https?|wss?|blob|chrome-extension|moz-extension):\/\/[^\s'")]+/gi;
const QUOTED = /(["'`])(?:(?!\1).){1,200}\1/g;
/** Tokens mixing letters and digits (ids, slugs with numbers, hashes) */
const MIXED_ID = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{6,}\b/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;

/** Message with the variable parts replaced, so "Video abc123 not found" and "Video def456 not found" group together. */
export function normalizeMessage(message: string): string {
  return message
    .replace(URL_RE, '<url>')
    .replace(UUID, '<id>')
    .replace(PREFIXED_ID, '<id>')
    .replace(QUOTED, '<str>')
    .replace(HEX, '<id>')
    .replace(MIXED_ID, '<id>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const LOCALE_SEGMENT = /^(en|ar)$/;
/** A path segment that is an id rather than a fixed name. */
function isIdSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return true;
  if (/^[a-z]{2,5}_[A-Za-z0-9-]{4,}$/.test(seg)) return true;
  if (seg.startsWith('@')) return true; // channel handles
  if (seg.length >= 8 && /\d/.test(seg) && /[A-Za-z]/.test(seg) && !seg.includes('-')) return true;
  if (seg.length >= 16 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)) return true;
  return false;
}

/** "/ar/video/abc123XYZ?v=1" → "/:locale/video/:id" (path only). */
export function normalizeRoute(route: string | undefined): string {
  if (!route) return '';
  const path = route.split(/[?#]/)[0] || '/';
  const segs = path.split('/').filter(Boolean);
  return (
    '/' +
    segs
      .map((s, i) => (i === 0 && LOCALE_SEGMENT.test(s) ? ':locale' : isIdSegment(s) ? ':id' : s))
      .join('/')
  ).slice(0, 200);
}

export interface StackFrame {
  fn: string;
  file: string;
  line?: number;
  column?: number;
}

const V8_FRAME = /^\s*at (?:(.+?) )?\(?((?:[a-z-]+:\/\/|\/|[A-Za-z]:\\|webpack|node:)[^\s)]*?|<anonymous>|native)(?::(\d+))?(?::(\d+))?\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@(.+?)(?::(\d+))?(?::(\d+))?\s*$/;

/** Parses V8 ("at fn (file:1:2)") and Gecko/WebKit ("fn@file:1:2") stack lines. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = V8_FRAME.exec(line) ?? (line.includes('@') ? GECKO_FRAME.exec(line) : null);
    if (!m) continue;
    frames.push({
      fn: (m[1] || '').trim().replace(/^at /, '') || '<anonymous>',
      file: m[2] || '',
      line: m[3] ? Number(m[3]) : undefined,
      column: m[4] ? Number(m[4]) : undefined,
    });
    if (frames.length >= 50) break;
  }
  return frames;
}

/** File name without origin, query or build hashes: ".../chunks/app/page-3f2a9c1b.js" → "chunks/app/page.js". */
export function stableFile(file: string): string {
  const path = file.replace(/^[a-z-]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
  const parts = path.split('/').filter(Boolean).slice(-3);
  return parts
    .map((p) => p.replace(/[.-][0-9a-f]{8,}(?=\.|$)/gi, '').replace(/^[0-9a-f]{8,}(?=\.)/i, '<h>'))
    .join('/');
}

/** Frames of our code: no framework internals, browser extensions or native code. */
export function isAppFrame(f: StackFrame): boolean {
  if (!f.file || f.file === 'native' || f.file === '<anonymous>') return false;
  if (/(chrome|moz|safari-web)-extension:/.test(f.file)) return false;
  if (/node_modules|next\/dist|react-dom|webpack\/bootstrap|framework-/.test(f.file)) return false;
  return true;
}

/** Top frames that identify where the error comes from; minified names (1-2 letters) are dropped. */
export function topFrames(frames: StackFrame[], n = 3): string[] {
  const app = frames.filter(isAppFrame);
  const chosen = (app.length ? app : frames).slice(0, n);
  return chosen.map((f) => {
    const fn = /^[A-Za-z_$][\w$]?$/.test(f.fn) ? '' : f.fn.replace(/^(async |new )/, '');
    return `${fn}@${stableFile(f.file)}`;
  });
}

export interface FingerprintInput {
  app: string;
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  /** Frames already symbolicated (original sources) win over the raw stack. */
  frames?: StackFrame[];
}

export function fingerprintParts(e: FingerprintInput): string[] {
  const frames = topFrames(e.frames ?? parseStack(e.stack));
  return [e.app, e.name || 'Error', normalizeMessage(e.message), ...frames, normalizeRoute(e.route)];
}

export function fingerprint(e: FingerprintInput): string {
  return hash64(fingerprintParts(e).join('\n'));
}

/** First app frame as "fn (file)" for the group's culprit line. */
export function culprit(e: FingerprintInput): string {
  const f = (e.frames ?? parseStack(e.stack)).find(isAppFrame);
  if (!f) return normalizeRoute(e.route);
  return `${f.fn} (${stableFile(f.file)})`.slice(0, 200);
}
