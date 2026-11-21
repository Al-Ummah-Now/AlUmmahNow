/**
 * Staff-set site fields (L10N rule, owner 2026-11-16): `POST /internal/translate` with
 * `mode: 'admin_field'` (api-videos lib/translate/admin-fields.ts, called by admin-api's staff-only
 * /api/translate/fields). English ↔ Arabic, Workers AI only, on the inline budget ledger.
 *
 * - The site's wording (SITE_COPY_RULES: «مرئي/مرئيات», placeholders kept) is in the prompt.
 * - The glossary is the CMS's (translation_glossary, the source of truth): read from
 *   `{CMS_INTERNAL_URL}/internal/glossary?from=&to=` with X-API-Key and kept for 5 minutes per
 *   isolate. Unreachable → translated without it (logged), never a second glossary here.
 * - Quran is never machine-translated: an item is refused (`refused: 'quran'`, text '') when it has
 *   mushaf marks, a {…} quotation in Arabic, an Arabic span the Quran matcher confirms, or when the
 *   model says it is a verse or a translation of one (answer ⟦QURAN⟧). The admin is told to use
 *   the official text and a recognised translation; references are returned when found.
 * - Placeholders ({name}, {{name}}, %s) travel as ⟦Qn⟧ tokens the batch check keeps in place.
 */
import type { Logger } from '@al-ummah/logger';
import {
  INLINE_TRANSLATE_MODELS,
  SITE_COPY_QURAN_MARKER as QURAN_MARKER,
  braceSpans,
  checkTranslatedBatch,
  formatQuranRange,
  looksLikeMushafText,
  matchQuran,
  quranAyahLabel,
  reportNeedsAction,
  type ExecutionContextLike,
  type InternalTranslateRequest,
  type InternalTranslateResponse,
  type MaskedCue,
  type QuranIndex,
} from '@al-ummah/shared-types';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { USD_PER_NEURON, neuronsFor } from '../moderation/pricing';
import { recordUsage } from '../moderation/usage';
import { loadQuranIndex } from '../quran/review-matcher';
import { getApiKey } from '../lib/websocket-notify';
import { ProviderError, type Usage } from '../review/provider';
import { translatorFor, withoutDeepl, type Translator } from './translator';
import { BudgetSpent, INLINE_FEATURE, quotationReference, type InlineTranslateEnv } from './inline';

export interface AdminFieldEnv extends InlineTranslateEnv {
  CMS_INTERNAL_URL?: string;
}


const PLACEHOLDER = /\{\{\s*[A-Za-z_][\w.]*\s*\}\}|\{[A-Za-z_][\w.]*\}|%(?:\d+\$)?[sd]/g;
const ARABIC = /[؀-ۿ]/;
const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

// ---------------------------------------------------------------------------
// The CMS glossary
// ---------------------------------------------------------------------------

type GlossaryEntry = { source: string; target: string };
let glossaryCache: { key: string; at: number; entries: GlossaryEntry[] } | null = null;
const GLOSSARY_TTL_MS = 5 * 60_000;

export function resetGlossaryCache(): void {
  glossaryCache = null;
}

export async function cmsGlossary(env: AdminFieldEnv, from: string, to: string, logger: Logger, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GlossaryEntry[]> {
  const base = env.CMS_INTERNAL_URL?.replace(/\/+$/, '');
  if (!base) return [];
  const key = `${base}|${from}|${to}`;
  if (glossaryCache && glossaryCache.key === key && now - glossaryCache.at < GLOSSARY_TTL_MS) return glossaryCache.entries;
  let entries: GlossaryEntry[] = [];
  try {
    const apiKey = await getApiKey(env.INTERNAL_API_KEY as never);
    const res = await fetcher(`${base}/internal/glossary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: { 'X-API-Key': apiKey ?? '', accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { entries?: Array<{ source?: unknown; target?: unknown }> } | null;
      entries = (body?.entries ?? []).filter((e): e is GlossaryEntry => typeof e.source === 'string' && typeof e.target === 'string' && !!e.source.trim() && !!e.target.trim());
    } else {
      logger.warn('[Translate] CMS glossary unavailable; translating without it', { status: res.status });
    }
  } catch (error) {
    logger.warn('[Translate] CMS glossary unreachable; translating without it', { error: error instanceof Error ? error.message : String(error) });
  }
  glossaryCache = { key, at: now, entries };
  return entries;
}

/** The entries whose source term occurs in the texts (longest first, at most 60). */
export function glossaryFor(entries: GlossaryEntry[], texts: string[]): GlossaryEntry[] {
  const hay = texts.join('\n').toLowerCase();
  return [...entries].filter((e) => hay.includes(e.source.toLowerCase())).sort((a, b) => b.source.length - a.source.length).slice(0, 60);
}

// ---------------------------------------------------------------------------
// Quran detection
// ---------------------------------------------------------------------------

/** The Quran references of a text that must not be machine-translated, or null when it may be. */
export function quranInText(index: QuranIndex | null, text: string): { refs: Array<{ range: string; label: string }> } | null {
  const refs: Array<{ range: string; label: string }> = [];
  let found = looksLikeMushafText(text);
  for (const span of braceSpans(text)) {
    if (!ARABIC.test(span.inner)) continue;
    found = true;
    const ref = quotationReference(index, span.inner);
    if (ref) refs.push(ref);
  }
  if (index && ARABIC.test(text)) {
    const words = text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, startMs: i * 500, endMs: i * 500 + 500 }));
    for (const m of matchQuran(index, words)) {
      if (m.class !== 'confirmed' || m.matchedWords.length < 4) continue;
      found = true;
      if (m.occurrences === 1) refs.push({ range: formatQuranRange(m.range), label: quranAyahLabel(m.range) });
    }
  }
  return found ? { refs } : null;
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

type Item = InternalTranslateResponse['items'][number];

export async function translateAdminFieldItems(
  env: AdminFieldEnv,
  req: Pick<InternalTranslateRequest, 'items' | 'from' | 'to'>,
  usage: Usage[],
  logger: Logger,
  deps: { translator?: Translator; index?: QuranIndex | null; now?: number; fetcher?: typeof fetch } = {},
): Promise<{ items: Item[]; provider: string; model: string }> {
  const index = deps.index !== undefined ? deps.index : await loadQuranIndex(env.REVIEW_MEDIA, deps.now ?? Date.now()).catch(() => null);
  const out = new Map<string, Item>();
  const masked: Array<MaskedCue & { originals: Map<string, string> }> = [];
  let n = 0;
  for (const item of req.items) {
    if (!item.text.trim()) {
      out.set(item.id, { id: item.id, text: '' });
      continue;
    }
    const quran = quranInText(index, item.text);
    if (quran) {
      out.set(item.id, { id: item.id, text: '', refused: 'quran', ...(quran.refs.length ? { quran: quran.refs } : {}) });
      continue;
    }
    const originals = new Map<string, string>();
    const tokens: MaskedCue['quran'] = [];
    const text = item.text.replace(PLACEHOLDER, (p) => {
      const token = `⟦Q${++n}⟧`;
      originals.set(token, p);
      tokens.push({ token, segment: { type: 'quran', range: '1:1:1-1:1:1', status: 'review' } });
      return token;
    });
    if (!text.replace(/⟦Q\d+⟧/g, '').trim()) out.set(item.id, { id: item.id, text: item.text });
    else masked.push({ id: item.id, text, quran: tokens, originals });
  }

  let provider = 'none';
  let model = 'none';
  if (masked.length) {
    const glossary = glossaryFor(await cmsGlossary(env, req.from, req.to, logger, deps.fetcher), masked.map((m) => m.text));
    const ctx = { siteCopy: true, ...(glossary.length ? { glossary } : {}) };
    const translator = deps.translator ?? (await translatorFor(withoutDeepl(env), 'workers-ai'));
    let last = 'no_attempt';
    for (const m of [INLINE_TRANSLATE_MODELS.primary, INLINE_TRANSLATE_MODELS.fallback]) {
      const answer = await translator.translate({ items: masked, context: [] }, req.from, req.to, ctx, m, usage);
      // The model's Quran refusals first, then the usual checks on the rest
      const refused = new Set<string>();
      if (Array.isArray(answer)) {
        answer.forEach((a, i) => {
          const text = typeof a === 'string' ? a : (a as { text?: unknown } | null)?.text;
          if (typeof text === 'string' && text.includes(QURAN_MARKER) && masked[i]) refused.add(masked[i]!.id);
        });
      }
      const rest = masked.filter((x) => !refused.has(x.id));
      const restAnswer = Array.isArray(answer) ? answer.filter((_, i) => masked[i] && !refused.has(masked[i]!.id)) : answer;
      const checked = rest.length ? checkTranslatedBatch(rest, restAnswer, req.to) : ({ ok: true, texts: new Map<string, string>() } as const);
      if (checked.ok) {
        for (const id of refused) out.set(id, { id, text: '', refused: 'quran' });
        const arabic = req.to.startsWith('ar');
        for (const x of rest) {
          let text = checked.texts.get(x.id) ?? '';
          for (const [token, original] of x.originals) text = text.replace(token, original);
          out.set(x.id, { id: x.id, text: arabic ? text : text.trim() });
        }
        provider = translator.provider;
        model = m;
        break;
      }
      last = (checked as { reason: string }).reason;
      logger.warn('[Translate] Admin field translation failed its check', { model: m, reason: last });
    }
    if (provider === 'none') throw new ProviderError(`translation failed its checks: ${last}`, true);
  }
  const arabicTo = req.to.startsWith('ar');
  return {
    provider,
    model,
    items: req.items.map((i) => {
      const item = out.get(i.id) ?? { id: i.id, text: '' };
      // References read in the target language
      return item.quran && arabicTo ? { ...item, quran: item.quran.map((q) => ({ ...q, label: toArabicDigits(q.label) })) } : item;
    }),
  };
}

/** Reserves, runs and records one staff-field translation against the inline budget. */
export async function translateAdminFieldsWithBudget(
  env: AdminFieldEnv,
  req: Pick<InternalTranslateRequest, 'items' | 'from' | 'to' | 'dailyBudgetUsd'>,
  logger: Logger,
  ctx: ExecutionContextLike | undefined,
  deps: { translator?: Translator; index?: QuranIndex | null; now?: number; fetcher?: typeof fetch } = {},
): Promise<InternalTranslateResponse> {
  const now = deps.now ?? Date.now();
  const chars = req.items.reduce((s, i) => s + i.text.length, 0);
  const estimate = neuronsFor(INLINE_TRANSLATE_MODELS.fallback, Math.ceil(chars / 2) + 900, Math.ceil(chars / 1.5) + 200) * 2;
  if (!(await reserveBudget(env.REPORTS_DB, req.dailyBudgetUsd / USD_PER_NEURON, estimate, now, INLINE_FEATURE))) {
    const day = new Date(now).toISOString().slice(0, 10);
    reportNeedsAction('processor', env, ctx, {
      key: `inline-translate-budget:${day}`,
      source: 'queue',
      title: "Today's translation budget is spent",
      message: `Translation is refused until tomorrow ($${req.dailyBudgetUsd}/day). Raise the monthly translation budget to allow more.`,
      extra: { dailyBudgetUsd: req.dailyBudgetUsd },
    });
    throw new BudgetSpent('inline translation budget spent');
  }
  const usage: Usage[] = [];
  let spent = 0;
  try {
    return { ...(await translateAdminFieldItems(env, req, usage, logger, deps)), usd: 0 };
  } finally {
    for (const u of usage) {
      if (u.model.startsWith('fixture/')) continue;
      spent += await recordUsage(env.REPORTS_DB, logger, { model: u.model, inputTokens: u.inputUnits, outputTokens: u.outputUnits, surface: 'admin-field-translate', feature: INLINE_FEATURE }, now);
    }
    await settleBudget(env.REPORTS_DB, estimate, spent, now, INLINE_FEATURE);
  }
}

