/**
 * Checks for the help content (wiki AUN-ADMIN-HELP "Coverage check"):
 *  - every area file has the shape of types.ts, every text in en and ar;
 *  - ids and anchors are unique, the popover texts stay brief;
 *  - Arabic has no 0–9 outside `{#…}`, URLs and Latin names (Arabic shows ٠–٩);
 *  - every form control in the covered folders names an entry (`data-help="<id>"`) or says why it
 *    is not a setting (`data-help-exempt="<reason>"`), every named id exists, and every entry is
 *    shown by a `<HelpTip id="…">`.
 * Dependency-free so the Auth admin and the CMS can vendor it.
 */
import { HELP_LOCALES, SUMMARY_MAX, TIP_CAUTION_MAX, type HelpArea } from './types.ts';

export interface Problem {
  file: string;
  line?: number;
  message: string;
}

const ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;
const ANCHOR = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 0–9 a reader would see in Arabic text: not in `{#…}`, a URL, a Latin word like OAuth2 or AES-256,
 * or a code span in backticks (a literal value the admin types, like a version `1.4.0`).
 */
export function latinDigitsInArabic(text: string): string[] {
  const stripped = text
    .replace(/\{#[^}]*\}/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Za-z][A-Za-z0-9._-]*/g, ' ');
  return stripped.match(/[0-9]+/g) ?? [];
}

function isBilingual(v: unknown): v is { en: string; ar: string } {
  return !!v && typeof v === 'object' && HELP_LOCALES.every((l) => typeof (v as Record<string, unknown>)[l] === 'string' && ((v as Record<string, string>)[l] ?? '').trim() !== '');
}

export function validateArea(file: string, raw: unknown, expectedSlug?: string): Problem[] {
  const out: Problem[] = [];
  const p = (message: string) => out.push({ file, message });
  if (!raw || typeof raw !== 'object') return [{ file, message: 'not a JSON object' }];
  const a = raw as HelpArea;
  if (typeof a.area !== 'string' || !SLUG.test(a.area)) p('area must be a lower-case slug');
  if (expectedSlug && a.area !== expectedSlug) p(`area "${a.area}" must match the file name "${expectedSlug}"`);
  if (typeof a.route !== 'string' || !a.route.startsWith('/')) p('route must start with /');
  for (const k of ['title', 'intro'] as const) if (!isBilingual(a[k])) p(`${k} needs en and ar`);
  if (!Array.isArray(a.settings) || a.settings.length === 0) {
    p('settings must be a non-empty list');
    return out;
  }
  const texts: { at: string; ar: string }[] = [];
  const add = (at: string, v: unknown) => {
    if (!isBilingual(v)) p(`${at} needs en and ar`);
    else texts.push({ at, ar: v.ar });
  };
  add('title', a.title);
  add('intro', a.intro);
  const anchors = new Set<string>();
  a.settings.forEach((e, i) => {
    const at = `settings[${i}]${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`;
    if (typeof e.id !== 'string' || !ID.test(e.id)) p(`${at}: id must be dotted camelCase, like platform.downloads.perDay`);
    if (typeof e.anchor !== 'string' || !ANCHOR.test(e.anchor)) p(`${at}: anchor must be a lower-case slug`);
    else if (anchors.has(e.anchor)) p(`${at}: anchor "${e.anchor}" is used twice`);
    else anchors.add(e.anchor);
    for (const k of ['label', 'summary', 'what', 'changes'] as const) add(`${at}.${k}`, e[k]);
    for (const k of ['tipCaution', 'default', 'range'] as const) if (e[k] !== undefined) add(`${at}.${k}`, e[k]);
    if (isBilingual(e.summary)) for (const l of HELP_LOCALES) if (e.summary[l].length > SUMMARY_MAX) p(`${at}.summary.${l} is ${e.summary[l].length} characters; the popover allows ${SUMMARY_MAX}`);
    if (isBilingual(e.tipCaution)) for (const l of HELP_LOCALES) if (e.tipCaution[l].length > TIP_CAUTION_MAX) p(`${at}.tipCaution.${l} is ${e.tipCaution[l].length} characters; the popover allows ${TIP_CAUTION_MAX}`);
    if (e.options !== undefined) {
      if (!Array.isArray(e.options) || e.options.length < 2) p(`${at}.options needs at least two choices`);
      else {
        e.options.forEach((o, j) => {
          if (typeof o.value !== 'string' || !o.value) p(`${at}.options[${j}].value is required`);
          add(`${at}.options[${j}].label`, o.label);
          add(`${at}.options[${j}].text`, o.text);
        });
        const defaults = e.options.filter((o) => o.default).length;
        if (defaults > 1) p(`${at}.options has ${defaults} defaults`);
      }
    }
    if (e.options === undefined && e.default === undefined) p(`${at}: a free input needs a default (or options marking one)`);
    if (!Array.isArray(e.cautions)) p(`${at}.cautions must be a list`);
    else e.cautions.forEach((c, j) => add(`${at}.cautions[${j}]`, c));
    if (!Array.isArray(e.rules)) p(`${at}.rules must be a list`);
    else
      e.rules.forEach((r, j) => {
        add(`${at}.rules[${j}]`, r);
        if (r.source !== undefined && !/^https:\/\//.test(r.source)) p(`${at}.rules[${j}].source must be an https URL`);
      });
    if (!Array.isArray(e.sources) || e.sources.length === 0) p(`${at}.sources must list the files that render the setting`);
  });
  for (const t of texts) {
    const bad = latinDigitsInArabic(t.ar);
    if (bad.length) p(`${t.at}.ar has 0–9 (${bad.join(', ')}); write numbers as {#n} so Arabic shows ٠–٩`);
  }
  return out;
}

/** Ids across areas must be unique. */
export function duplicateIds(areas: { file: string; area: HelpArea }[]): Problem[] {
  const seen = new Map<string, string>();
  const out: Problem[] = [];
  for (const { file, area } of areas) {
    for (const e of area.settings ?? []) {
      const prev = seen.get(e.id);
      if (prev) out.push({ file, message: `id "${e.id}" is also in ${prev}` });
      else seen.set(e.id, file);
    }
  }
  return out;
}

// ── Control scanning ─────────────────────────────────────────────────────────────────────────────

/** JSX elements that are form controls. Components are listed by name. */
export const CONTROL_TAGS = ['input', 'select', 'textarea', 'NumberField', 'Select', 'Switch', 'Toggle', 'LocalizedFieldPair', 'DateField', 'Autocomplete'];

export interface FoundControl {
  tag: string;
  line: number;
  help: string | null;
  exempt: string | null;
  hidden: boolean;
}

/** The text of a JSX opening tag starting at `start` (at `<`), honoring braces and quotes. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*['"\`]([^'"\`]*)['"\`]\\s*\\})`));
  if (m) return m[1] ?? m[2] ?? m[3] ?? '';
  return new RegExp(`\\s${name}=\\{`).test(tag) ? '{expr}' : null;
}

export function findControls(src: string): FoundControl[] {
  const out: FoundControl[] = [];
  const re = new RegExp(`<(${CONTROL_TAGS.join('|')})(?=[\\s/>])`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const tag = openingTag(src, m.index);
    const type = attr(tag, 'type');
    out.push({
      tag: m[1] ?? '',
      line: src.slice(0, m.index).split('\n').length,
      help: attr(tag, 'data-help'),
      exempt: attr(tag, 'data-help-exempt'),
      hidden: type === 'hidden',
    });
  }
  return out;
}

/** Ids shown by a `<HelpTip id="…">` (or `helpId="…"` on a shared field) in a file. */
export function tipIds(src: string): string[] {
  const ids: string[] = [];
  for (const m of src.matchAll(/<HelpTip\b[^>]*?\sid=["']([^"']+)["']/g)) ids.push(m[1] ?? '');
  for (const m of src.matchAll(/\shelpId=["']([^"']+)["']/g)) ids.push(m[1] ?? '');
  return ids;
}

export function checkControls(file: string, src: string, known: ReadonlySet<string>): Problem[] {
  const out: Problem[] = [];
  for (const c of findControls(src)) {
    if (c.hidden) continue;
    if (c.exempt !== null) {
      if (!c.exempt.trim()) out.push({ file, line: c.line, message: `<${c.tag}> data-help-exempt needs a reason` });
      continue;
    }
    if (c.help === null) {
      out.push({ file, line: c.line, message: `<${c.tag}> has no help: add data-help="<id>" with an entry in packages/admin-help/content, or data-help-exempt="<reason>" if it is not a setting (a search box, a filter)` });
      continue;
    }
    if (c.help === '{expr}') continue; // an id chosen at run time (rows from a list): checked by the entry-used rule
    if (!known.has(c.help)) out.push({ file, line: c.line, message: `<${c.tag}> data-help="${c.help}" has no help entry` });
  }
  for (const id of tipIds(src)) if (!known.has(id)) out.push({ file, message: `<HelpTip id="${id}"> has no help entry` });
  return out;
}
