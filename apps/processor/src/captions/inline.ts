/**
 * Inline title/description translation (AUN-CAPTIONS §5.8, #810) and viewer-side translated
 * titles (§5.9, O6): the model step, run by the processor (it holds Workers AI, the AI budget and
 * the usage ledger).
 *
 * - `POST /internal/translate` (X-API-Key): api-videos' synchronous Translate button. Gemma 4 26B
 *   first, DeepSeek V4.1 Flash as the fallback (DeepL when an admin turned it on).
 * - MessageType.MetadataTranslate (videos queue): a video's title and description for viewers of
 *   another language, written back to api-videos `POST /internal/captions/metadata-translations`.
 *   Retries with backoff; the last attempt flags the admin.
 *
 * Text inside {…} is a Quran quotation by convention: it is masked as a token, never translated,
 * and gets its reference when the Quran matcher finds it in exactly one place. Each call reserves
 * its cost from the day's inline-translation budget; when it is spent the call is refused and the
 * admin is told once a day.
 */
import type { Logger } from '@al-ummah/logger';
import {
  INLINE_TRANSLATE_LIMITS,
  INLINE_TRANSLATE_MODELS,
  MessageType,
  braceSpans,
  checkTranslatedBatch,
  matchQuran,
  formatQuranRange,
  quranAyahLabel,
  reportNeedsAction,
  type D1Database,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type InternalTranslateRequest,
  type InternalTranslateResponse,
  type MaskedCue,
  type MetadataTranslatePayload,
  type QuranIndex,
} from '@al-ummah/shared-types';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { USD_PER_NEURON, neuronsFor } from '../moderation/pricing';
import { recordUsage } from '../moderation/usage';
import { loadQuranIndex } from '../quran/review-matcher';
import { ProviderError, type Usage } from '../review/provider';
import { DeeplError, flagDeeplFailure, translatorFor, withoutDeepl, type Translator, type TranslatorEnv } from './translator';
import { translateAdminFieldsWithBudget } from './admin-fields';

export const INLINE_FEATURE = 'inline_translate';
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

export interface InlineTranslateEnv extends ErrorReporterEnv, TranslatorEnv {
  REPORTS_DB: D1Database;
  /** The CMS (its translation glossary, for staff-set fields: admin-fields.ts) */
  CMS_INTERNAL_URL?: string;
  REVIEW_MEDIA?: { get(key: string): Promise<{ text(): Promise<string> } | null> };
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

export class BudgetSpent extends Error {}

const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

/** A {…} quotation's unique reference, or null (not found, or in more than one place). */
export function quotationReference(index: QuranIndex | null, inner: string): { range: string; label: string } | null {
  if (!index) return null;
  const words = inner.split(/\s+/).filter(Boolean).map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 500 }));
  if (words.length < 2) return null;
  const matches = matchQuran(index, words).filter((m) => m.class !== 'review' && m.occurrences === 1);
  if (matches.length !== 1) return null;
  return { range: formatQuranRange(matches[0]!.range), label: quranAyahLabel(matches[0]!.range) };
}

/**
 * Translates items with Quran quotations masked. Returns the texts with each quotation put back as
 * written, followed by its reference when it is unique.
 */
export async function translateItems(
  env: InlineTranslateEnv,
  req: Pick<InternalTranslateRequest, 'items' | 'from' | 'to' | 'provider' | 'context'>,
  usage: Usage[],
  logger: Logger,
  deps: { translator?: Translator; index?: QuranIndex | null; now?: number } = {},
): Promise<{ items: InternalTranslateResponse['items']; provider: string; model: string }> {
  const index = deps.index !== undefined ? deps.index : await loadQuranIndex(env.REVIEW_MEDIA, deps.now ?? Date.now()).catch(() => null);
  let n = 0;
  const masked: Array<MaskedCue & { originals: Map<string, { inner: string; ref: { range: string; label: string } | null }> }> = req.items.map((item) => {
    const originals = new Map<string, { inner: string; ref: { range: string; label: string } | null }>();
    const quran: MaskedCue['quran'] = [];
    let text = '';
    let at = 0;
    for (const span of braceSpans(item.text)) {
      const token = `⟦Q${++n}⟧`;
      text += item.text.slice(at, span.start) + token;
      at = span.end;
      originals.set(token, { inner: span.inner, ref: quotationReference(index, span.inner) });
      quran.push({ token, segment: { type: 'quran', range: '1:1:1-1:1:1', status: 'review' } });
    }
    text += item.text.slice(at);
    return { id: item.id, text, quran, originals };
  });
  const toTranslate = masked.filter((m) => m.text.replace(/⟦Q\d+⟧/g, '').trim());
  const ctx = { ...(req.context?.title ? { title: req.context.title } : {}), ...(req.context?.channel ? { channel: req.context.channel } : {}) };
  let texts = new Map<string, string>();
  let provider = 'none';
  let model = 'none';
  if (toTranslate.length) {
    const primary = deps.translator ?? (await translatorFor(env, req.provider));
    const fallback = primary.provider === 'deepl' ? await translatorFor(withoutDeepl(env), 'workers-ai') : primary;
    const attempts: Array<[Translator, string]> = [
      [primary, INLINE_TRANSLATE_MODELS.primary],
      [fallback, INLINE_TRANSLATE_MODELS.fallback],
    ];
    let last = 'no_attempt';
    for (const [t, m] of attempts) {
      let answer: unknown[] | null;
      try {
        answer = await t.translate({ items: toTranslate, context: [] }, req.from, req.to, ctx, m, usage);
      } catch (error) {
        // DeepL refused (wrong key, characters used up, outage): flag the admin, go on with Workers AI
        if (!(error instanceof DeeplError)) throw error;
        flagDeeplFailure(env, undefined, logger, error, { surface: 'inline' });
        last = `deepl_${error.code}`;
        continue;
      }
      const checked = checkTranslatedBatch(toTranslate, answer, req.to);
      if (checked.ok) {
        texts = checked.texts;
        provider = t.provider;
        model = t.provider === 'deepl' ? 'deepl-pro' : m;
        break;
      }
      last = (checked as Extract<typeof checked, { ok: false }>).reason;
      logger.warn('[Translate] Inline translation failed its check', { model: m, reason: last });
    }
    if (provider === 'none') throw new ProviderError(`translation failed its checks: ${last}`, true);
  }
  const arabic = req.to.startsWith('ar');
  return {
    provider,
    model,
    items: masked.map((m) => {
      let text = texts.get(m.id) ?? m.text;
      const quran: Array<{ range: string; label: string }> = [];
      for (const [token, o] of m.originals) {
        const ref = o.ref ? ` (${arabic ? `القرآن ${toArabicDigits(o.ref.label)}` : `Quran ${o.ref.label}`})` : '';
        text = text.replace(token, `{${o.inner}}${ref}`);
        if (o.ref) quran.push(o.ref);
      }
      return { id: m.id, text: text.trim(), ...(quran.length ? { quran } : {}) };
    }),
  };
}

/** Reserves, runs and records one translation against the inline budget. */
export async function translateWithBudget(
  env: InlineTranslateEnv,
  req: Pick<InternalTranslateRequest, 'items' | 'from' | 'to' | 'provider' | 'context' | 'dailyBudgetUsd'>,
  logger: Logger,
  ctx: ExecutionContextLike | undefined,
  deps: { translator?: Translator; index?: QuranIndex | null; now?: number } = {},
): Promise<InternalTranslateResponse> {
  const now = deps.now ?? Date.now();
  const chars = req.items.reduce((s, i) => s + i.text.length, 0);
  const estimate = req.provider === 'deepl' ? neuronsFor('deepl-pro', chars, 0) * 2 : neuronsFor(INLINE_TRANSLATE_MODELS.fallback, Math.ceil(chars / 2) + 700, Math.ceil(chars / 1.5) + 200) * 2;
  if (!(await reserveBudget(env.REPORTS_DB, req.dailyBudgetUsd / USD_PER_NEURON, estimate, now, INLINE_FEATURE))) {
    const day = new Date(now).toISOString().slice(0, 10);
    reportNeedsAction('processor', env, ctx, {
      key: `inline-translate-budget:${day}`,
      source: 'queue',
      title: "Today's translation budget is spent",
      message: `Title and description translation is refused until tomorrow ($${req.dailyBudgetUsd}/day). Raise the monthly translation budget to allow more.`,
      extra: { dailyBudgetUsd: req.dailyBudgetUsd },
    });
    throw new BudgetSpent('inline translation budget spent');
  }
  const usage: Usage[] = [];
  let spent = 0;
  try {
    const result = await translateItems(env, req, usage, logger, deps);
    return { ...result, usd: 0 };
  } finally {
    for (const u of usage) {
      if (u.model.startsWith('fixture/')) continue;
      spent += await recordUsage(env.REPORTS_DB, logger, { model: u.model, inputTokens: u.inputUnits, outputTokens: u.outputUnits, surface: 'inline-translate', feature: INLINE_FEATURE }, now);
    }
    await settleBudget(env.REPORTS_DB, estimate, spent, now, INLINE_FEATURE);
  }
}

export function parseInternalTranslate(body: unknown): InternalTranslateRequest | null {
  const b = body as Partial<InternalTranslateRequest> | null;
  if (!b || !Array.isArray(b.items) || !b.items.length || b.items.length > INLINE_TRANSLATE_LIMITS.texts) return null;
  if (typeof b.from !== 'string' || !LANGUAGE.test(b.from) || typeof b.to !== 'string' || !LANGUAGE.test(b.to) || b.from === b.to) return null;
  let chars = 0;
  for (const i of b.items) {
    if (!i || typeof i.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(i.id) || typeof i.text !== 'string' || i.text.length > INLINE_TRANSLATE_LIMITS.textChars) return null;
    chars += i.text.length;
  }
  if (chars > INLINE_TRANSLATE_LIMITS.chars) return null;
  if (b.provider !== 'workers-ai' && b.provider !== 'deepl') return null;
  if (typeof b.dailyBudgetUsd !== 'number' || b.dailyBudgetUsd < 0) return null;
  if (b.mode !== undefined && b.mode !== 'admin_field') return null;
  // Staff-set fields: English ↔ Arabic on Workers AI only
  if (b.mode === 'admin_field' && (!['en', 'ar'].includes(b.from) || !['en', 'ar'].includes(b.to))) return null;
  return {
    items: b.items,
    from: b.from,
    to: b.to,
    field: (b.field ?? 'title') as InternalTranslateRequest['field'],
    provider: b.mode === 'admin_field' ? 'workers-ai' : b.provider,
    dailyBudgetUsd: b.dailyBudgetUsd,
    feature: 'inline_translate',
    ...(b.context && b.mode !== 'admin_field' ? { context: b.context } : {}),
    ...(b.mode ? { mode: b.mode } : {}),
  };
}

/** POST /internal/translate (the caller is checked by index.ts). */
export async function handleInternalTranslate(request: Request, env: InlineTranslateEnv, logger: Logger, ctx?: ExecutionContextLike): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const req = parseInternalTranslate(await request.json().catch(() => null));
  if (!req) return json({ error: 'invalid_request' }, 400);
  const startedAt = Date.now();
  try {
    const result = req.mode === 'admin_field' ? await translateAdminFieldsWithBudget(env, req, logger, ctx) : await translateWithBudget(env, req, logger, ctx);
    logger.request({ method: 'POST', route: '/internal/translate', status: 200, durationMs: Date.now() - startedAt, items: req.items.length, provider: result.provider, model: result.model, mode: req.mode ?? 'inline' });
    return json(result);
  } catch (error) {
    if (error instanceof BudgetSpent) return json({ error: 'budget_spent' }, 503);
    logger.error('[Translate] Inline translation failed', { error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'translation_failed' }, 502);
  }
}

// ---------------------------------------------------------------------------
// Viewer-side titles (queue)
// ---------------------------------------------------------------------------

export interface MetadataTranslateQueueMessage {
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

export const isMetadataTranslateMessage = (m: { body?: { type?: unknown } | null }) => m.body?.type === MessageType.MetadataTranslate;

function isPayload(p: unknown): p is MetadataTranslatePayload {
  const x = p as Partial<MetadataTranslatePayload> | null;
  return (
    !!x &&
    typeof x.videoId === 'string' &&
    /^[A-Za-z0-9_-]{1,80}$/.test(x.videoId) &&
    typeof x.lang === 'string' &&
    LANGUAGE.test(x.lang) &&
    typeof x.from === 'string' &&
    LANGUAGE.test(x.from) &&
    typeof x.sourceHash === 'string' &&
    /^[a-f0-9]{64}$/.test(x.sourceHash) &&
    typeof x.title === 'string' &&
    x.title.length <= 1000 &&
    (x.description === undefined || (typeof x.description === 'string' && x.description.length <= INLINE_TRANSLATE_LIMITS.textChars)) &&
    typeof x.dailyBudgetUsd === 'number'
  );
}

const LAST_ATTEMPT = 4;

async function secret(value: ErrorReporterEnv['INTERNAL_API_KEY']): Promise<string> {
  const v = value as string | { get(): Promise<string> } | undefined;
  return typeof v === 'string' ? v : ((await v?.get()) ?? '');
}

export async function processMetadataTranslateMessages(messages: MetadataTranslateQueueMessage[], env: InlineTranslateEnv, ctx: ExecutionContextLike | undefined, logger: Logger, deps: { translator?: Translator; index?: QuranIndex | null } = {}): Promise<void> {
  for (const message of messages) {
    const p = message.body?.payload;
    if (!isPayload(p)) {
      logger.warn('[Translate] Invalid metadata translate message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    try {
      const items = [{ id: 'title', text: p.title }, ...(p.description?.trim() ? [{ id: 'description', text: p.description }] : [])];
      const result = await translateWithBudget(env, { items, from: p.from, to: p.lang, provider: 'workers-ai', dailyBudgetUsd: p.dailyBudgetUsd }, logger, ctx, deps);
      if (!env.VIDEOS) throw new Error('VIDEOS service binding missing');
      const res = await env.VIDEOS.fetch('https://videos.internal/internal/captions/metadata-translations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
        body: JSON.stringify({
          videoId: p.videoId,
          lang: p.lang,
          sourceHash: p.sourceHash,
          title: result.items.find((i) => i.id === 'title')?.text ?? '',
          description: result.items.find((i) => i.id === 'description')?.text ?? null,
          provider: result.provider,
          model: result.model,
        }),
      });
      if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`api-videos answered ${res.status}`);
      message.ack();
    } catch (error) {
      if (error instanceof BudgetSpent) {
        // Viewers see the original until tomorrow's budget; the next view asks again
        message.ack();
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      if (attempts < LAST_ATTEMPT) {
        message.retry({ delaySeconds: Math.min(1800, 60 * 2 ** (attempts - 1)) });
        continue;
      }
      logger.error('[Translate] Viewer title translation gave up', { videoId: p.videoId, lang: p.lang, attempts, reason });
      reportNeedsAction('processor', env, ctx, {
        key: `metadata-translate:${p.videoId}:${p.lang}`,
        source: 'queue',
        title: 'Viewer title translation failed',
        message: reason.slice(0, 500),
        itemType: 'video',
        itemId: p.videoId,
        extra: { lang: p.lang, attempts },
      });
      message.ack();
    }
  }
}
