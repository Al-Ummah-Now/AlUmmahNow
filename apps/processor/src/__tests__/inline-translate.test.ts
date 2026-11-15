/**
 * Inline title/description translation (AUN-CAPTIONS §5.8) and viewer-side titles (§5.9) in the
 * processor: {…} Quran quotations are never machine-translated (kept as written, with their
 * reference when unique), the inline budget refuses once spent, and the viewer-title queue writes
 * back to api-videos. Fixture translator only: no AI.
 */
jest.mock('../moderation/budget', () => ({ reserveBudget: jest.fn(async () => true), settleBudget: jest.fn(async () => undefined) }));
jest.mock('../moderation/usage', () => ({ recordUsage: jest.fn(async () => 10) }));

import { MessageType, QuranIndex } from '@al-ummah/shared-types';
import { reserveBudget } from '../moderation/budget';
import { handleInternalTranslate, parseInternalTranslate, processMetadataTranslateMessages, quotationReference, translateWithBudget } from '../captions/inline';
import { FixtureTranslator } from '../captions/translator';
import { miniQuranRows } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn(), request: jest.fn() } as never;
const index = new QuranIndex(QuranIndex.build(miniQuranRows(), 'v-test', new Date().toISOString()));
const IKHLAS = 'قل هو الله احد الله الصمد';
const env = { REPORTS_DB: {} as never, TRANSLATION_PROVIDER: 'fixture', INTERNAL_API_KEY: 'internal', ERRORS_INGEST_URL: 'https://admin.example/internal/errors' };

beforeEach(() => {
  (reserveBudget as jest.Mock).mockResolvedValue(true);
  globalThis.fetch = jest.fn(async () => new Response('{}')) as never;
});

describe('inline translation', () => {
  it('keeps {…} Quran quotations as written and adds a unique reference', async () => {
    const out = await translateWithBudget(env, { items: [{ id: 't', text: `تفسير {${IKHLAS}} للشيخ` }], from: 'ar', to: 'en', provider: 'workers-ai', dailyBudgetUsd: 1 }, logger, undefined, { translator: new FixtureTranslator(), index });
    const text = out.items[0]!.text;
    expect(text).toContain(`{${IKHLAS}}`);
    expect(text).toMatch(/\(Quran 112:1/);
    expect(out.items[0]!.quran?.[0]!.range).toMatch(/^112:1/);
    expect(text).not.toContain('تفسير');
  });

  it('a quotation-only title is never sent to a model', async () => {
    const translator = { provider: 'workers-ai' as const, translate: jest.fn() };
    const out = await translateWithBudget(env, { items: [{ id: 't', text: `{${IKHLAS}}` }], from: 'ar', to: 'en', provider: 'workers-ai', dailyBudgetUsd: 1 }, logger, undefined, { translator, index });
    expect(translator.translate).not.toHaveBeenCalled();
    expect(out.items[0]!.text.startsWith(`{${IKHLAS}}`)).toBe(true);
  });

  it('no reference for text not found in the Quran', () => {
    expect(quotationReference(index, 'كلام عادي ليس من القرآن')).toBeNull();
    expect(quotationReference(null, IKHLAS)).toBeNull();
  });

  it('refuses once the day’s budget is spent and tells the admin', async () => {
    (reserveBudget as jest.Mock).mockResolvedValue(false);
    const res = await handleInternalTranslate(
      new Request('https://p/internal/translate', { method: 'POST', body: JSON.stringify({ items: [{ id: 't', text: 'A talk' }], from: 'en', to: 'ar', provider: 'workers-ai', dailyBudgetUsd: 0.6, feature: 'inline_translate' }) }),
      env,
      logger,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'budget_spent' });
    const report = JSON.parse(String((globalThis.fetch as jest.Mock).mock.calls.at(-1)[1].body));
    expect(report.events[0].action.key).toMatch(/^inline-translate-budget:/);
  });

  it('answers translations over the internal route', async () => {
    const res = await handleInternalTranslate(
      new Request('https://p/internal/translate', { method: 'POST', body: JSON.stringify({ items: [{ id: 't', text: 'The night prayer' }], from: 'en', to: 'ar', provider: 'workers-ai', dailyBudgetUsd: 0.6, feature: 'inline_translate' }) }),
      env,
      logger,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ text: string }>; provider: string };
    expect(body.provider).toBe('fixture');
    expect(body.items[0]!.text).toMatch(/[؀-ۿ]/);
  });

  it('validates requests', () => {
    const ok = { items: [{ id: 't', text: 'x' }], from: 'en', to: 'ar', provider: 'workers-ai', dailyBudgetUsd: 1 };
    expect(parseInternalTranslate(ok)).not.toBeNull();
    expect(parseInternalTranslate({ ...ok, to: 'en' })).toBeNull();
    expect(parseInternalTranslate({ ...ok, items: Array.from({ length: 51 }, (_, i) => ({ id: `i${i}`, text: 'x' })) })).toBeNull();
    expect(parseInternalTranslate({ ...ok, items: [{ id: 't', text: 'x'.repeat(5001) }] })).toBeNull();
    expect(parseInternalTranslate({ ...ok, provider: 'openai' })).toBeNull();
  });
});

describe('viewer-side titles queue', () => {
  const payload = { videoId: 'v1', lang: 'ar', from: 'en', sourceHash: 'a'.repeat(64), title: 'The night prayer', description: 'A talk about the night prayer', dailyBudgetUsd: 0.6, requestedAt: '2026-11-14T00:00:00.000Z' };
  const message = (p: unknown = payload, attempts = 1) => ({ body: { id: 'm', type: MessageType.MetadataTranslate, payload: p }, attempts, ack: jest.fn(), retry: jest.fn() });

  it('translates title and description and writes them back to api-videos', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const VIDEOS = { fetch: jest.fn(async (_u: RequestInfo, init?: RequestInit) => (posted.push(JSON.parse(String(init?.body))), new Response('{}'))) };
    const m = message();
    await processMetadataTranslateMessages([m], { ...env, VIDEOS }, undefined, logger, { index: null });
    expect(m.ack).toHaveBeenCalled();
    expect(String(VIDEOS.fetch.mock.calls[0]![0])).toContain('/internal/captions/metadata-translations');
    expect(posted[0]).toMatchObject({ videoId: 'v1', lang: 'ar', sourceHash: 'a'.repeat(64), provider: 'fixture' });
    expect(String(posted[0]!.title)).toMatch(/[؀-ۿ]/);
  });

  it('retries with backoff, then flags the admin', async () => {
    const VIDEOS = { fetch: jest.fn(async () => new Response('{}', { status: 500 })) };
    const early = message(payload, 1);
    await processMetadataTranslateMessages([early], { ...env, VIDEOS }, undefined, logger, { index: null });
    expect(early.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    const last = message(payload, 4);
    await processMetadataTranslateMessages([last], { ...env, VIDEOS }, undefined, logger, { index: null });
    expect(last.ack).toHaveBeenCalled();
    const report = JSON.parse(String((globalThis.fetch as jest.Mock).mock.calls.at(-1)[1].body));
    expect(report.events[0].action).toMatchObject({ key: 'metadata-translate:v1:ar', title: 'Viewer title translation failed' });
  });

  it('a spent budget leaves the original (no retry); bad payloads are dropped', async () => {
    (reserveBudget as jest.Mock).mockResolvedValue(false);
    const VIDEOS = { fetch: jest.fn() };
    const m = message();
    await processMetadataTranslateMessages([m], { ...env, VIDEOS }, undefined, logger, { index: null });
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(VIDEOS.fetch).not.toHaveBeenCalled();
    const bad = message({ ...payload, sourceHash: 'x' });
    await processMetadataTranslateMessages([bad], { ...env, VIDEOS }, undefined, logger);
    expect(bad.ack).toHaveBeenCalled();
  });
});
