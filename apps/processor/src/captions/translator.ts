/**
 * Machine translation providers (AUN-CAPTIONS §5.7, §5.8, §10), behind one interface so tests, CI
 * and the local stack never call a paid model:
 *
 * - WorkersAiTranslator: an LLM on Workers AI (DeepSeek V4.1 Flash, Gemma 4 26B) with the shared
 *   system prompt; answers a JSON array of { id, text }.
 * - DeepLTranslator:     DeepL API Pro (optional, off by default, O2). Quran tokens travel as XML
 *   tags DeepL never translates.
 * - FixtureTranslator:   deterministic text in the target script, tokens kept (tests, local stack).
 *
 * A loud guard refuses the real providers under test, CI or E2E. Quran is never sent as text: the
 * callers mask it as ⟦Qn⟧ tokens first.
 */
import { ARABIC_SCRIPT_LANGUAGES, cueBatchPrompt, parseJsonArray, translationSystemPrompt, type MaskedCue, type TranslationPromptContext } from '@al-ummah/shared-types';
import { ProviderError, assertRealAiAllowed, chatText, tokenUsage, type AiRunner, type Usage } from '../review/provider';

export interface TranslateItem {
  id: string;
  text: string;
}

export interface Translator {
  readonly provider: 'workers-ai' | 'deepl' | 'fixture';
  /** The model's raw answer for a batch: a JSON-array-like value the caller checks. */
  translate(batch: { items: MaskedCue[]; context: MaskedCue[] }, from: string, to: string, ctx: TranslationPromptContext, model: string, usage: Usage[]): Promise<unknown[] | null>;
}

interface GuardEnv {
  NODE_ENV?: string;
  CI?: string;
  E2E_ENV?: string;
  AI_GATEWAY_ID?: string;
}

export class WorkersAiTranslator implements Translator {
  readonly provider = 'workers-ai' as const;
  private readonly gatewayId: string | undefined;
  constructor(
    private readonly ai: AiRunner,
    env: GuardEnv,
  ) {
    assertRealAiAllowed(env);
    this.gatewayId = env.AI_GATEWAY_ID || undefined;
  }

  async translate(batch: { items: MaskedCue[]; context: MaskedCue[] }, from: string, to: string, ctx: TranslationPromptContext, model: string, usage: Usage[]): Promise<unknown[] | null> {
    const chars = batch.items.reduce((n, i) => n + i.text.length, 0);
    let result: unknown;
    try {
      result = await this.ai.run(
        model,
        {
          messages: [
            { role: 'system', content: translationSystemPrompt(from, to, ctx) },
            { role: 'user', content: cueBatchPrompt(batch, to) },
          ],
          // Arabic takes more tokens per character; room for the JSON around it
          max_tokens: Math.min(8192, Math.ceil(chars * 1.6) + 400),
          temperature: 0.1,
          chat_template_kwargs: { enable_thinking: false },
        },
        this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`${model}: ${message}`, !/invalid|too large|unsupported|400/i.test(message));
    }
    const t = tokenUsage(result);
    // A model that reports no usage is counted from the characters (never under-counted)
    usage.push({ model, inputUnits: t.in || Math.ceil(chars / 2) + 500, outputUnits: t.out || Math.ceil(chars / 2) });
    const text = chatText(result);
    return typeof text === 'string' ? parseJsonArray(text) : Array.isArray(text) ? text : null;
  }
}

/** DeepL language codes (target codes need a variant for English and Portuguese). */
const deeplTarget = (lang: string) => {
  const base = lang.split('-')[0]!.toUpperCase();
  return base === 'EN' ? 'EN-US' : base === 'PT' ? 'PT-PT' : base;
};

export class DeepLTranslator implements Translator {
  readonly provider = 'deepl' as const;
  constructor(
    private readonly key: string,
    env: GuardEnv,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    assertRealAiAllowed(env);
  }

  async translate(batch: { items: MaskedCue[]; context: MaskedCue[] }, from: string, to: string, ctx: TranslationPromptContext, _model: string, usage: Usage[]): Promise<unknown[] | null> {
    const toXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/⟦(Q\d+)⟧/g, '<q id="$1"/>');
    const fromXml = (t: string) => t.replace(/<q id="(Q\d+)"\s*\/>/g, '⟦$1⟧').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const texts = batch.items.map((i) => toXml(i.text));
    const res = await this.fetchImpl(this.key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate', {
      method: 'POST',
      headers: { authorization: `DeepL-Auth-Key ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: texts,
        source_lang: from.split('-')[0]!.toUpperCase(),
        target_lang: deeplTarget(to),
        tag_handling: 'xml',
        ignore_tags: ['q'],
        ...(ctx.title || ctx.channel ? { context: [ctx.channel, ctx.title].filter(Boolean).join(' — ').slice(0, 500) } : {}),
      }),
    });
    if (!res.ok) throw new ProviderError(`deepl: ${res.status}`, res.status === 429 || res.status >= 500);
    const body = (await res.json().catch(() => null)) as { translations?: Array<{ text?: string }> } | null;
    usage.push({ model: 'deepl-pro', inputUnits: texts.reduce((n, t) => n + t.length, 0), outputUnits: 0 });
    if (!body?.translations || body.translations.length !== batch.items.length) return null;
    return batch.items.map((item, i) => ({ id: item.id, text: fromXml(body.translations![i]!.text ?? '') }));
  }
}

/** Deterministic target-script text per item, tokens kept in order (tests and the local stack). */
export class FixtureTranslator implements Translator {
  readonly provider = 'fixture' as const;
  async translate(batch: { items: MaskedCue[]; context: MaskedCue[] }, _from: string, to: string, _ctx: TranslationPromptContext, _model: string, usage: Usage[]): Promise<unknown[] | null> {
    usage.push({ model: 'fixture/translate', inputUnits: 0, outputUnits: 0 });
    const arabic = ARABIC_SCRIPT_LANGUAGES.has(to.split('-')[0]!.toLowerCase());
    return batch.items.map((item) => {
      const tokens = item.text.match(/⟦Q\d+⟧/g) ?? [];
      const words = item.text.replace(/⟦Q\d+⟧/g, '').trim();
      // About as long as the source, so the answer passes the length check like a real one
      const unit = arabic ? 'ترجمة تجريبية ' : `Fixture ${to} translation `;
      const body = words ? unit.repeat(Math.max(1, Math.ceil(words.length / unit.length))).slice(0, Math.max(words.length, unit.trim().length)).trim() : '';
      return { id: item.id, text: [body, ...tokens].filter(Boolean).join(' ') };
    });
  }
}

export interface TranslatorEnv extends GuardEnv {
  AI?: AiRunner;
  AI_KEY_DEEPL?: string | { get(): Promise<string> };
  /** "fixture": never a model (local stack, E2E) */
  TRANSLATION_PROVIDER?: string;
  CAPTION_PROVIDER?: string;
}

export async function deeplKey(env: TranslatorEnv): Promise<string | null> {
  const v = env.AI_KEY_DEEPL;
  if (!v) return null;
  const key = typeof v === 'string' ? v : await v.get().catch(() => '');
  return key || null;
}

/** The translator for a provider; DeepL without a key falls back to Workers AI. */
export async function translatorFor(env: TranslatorEnv, provider: 'workers-ai' | 'deepl'): Promise<Translator> {
  if (env.TRANSLATION_PROVIDER === 'fixture' || env.CAPTION_PROVIDER === 'fixture') return new FixtureTranslator();
  if (provider === 'deepl') {
    const key = await deeplKey(env);
    if (key) return new DeepLTranslator(key, env);
  }
  if (!env.AI) throw new ProviderError('AI binding missing', false);
  return new WorkersAiTranslator(env.AI, env);
}
