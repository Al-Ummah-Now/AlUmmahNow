/**
 * Staff-set field translation (L10N rule) in the processor: Workers AI only (fixture here, never a
 * model), the site's wording rules and the CMS glossary in the prompt, placeholders kept, and Quran
 * text refused rather than translated (mushaf marks, {…} quotations, matcher hits, the model's own
 * ⟦QURAN⟧ answer). No AI: a scripted translator or the fixture.
 */
jest.mock('../moderation/budget', () => ({ reserveBudget: jest.fn(async () => true), settleBudget: jest.fn(async () => undefined) }));
jest.mock('../moderation/usage', () => ({ recordUsage: jest.fn(async () => 10) }));

import { QuranIndex, translationSystemPrompt } from '@al-ummah/shared-types';
import { reserveBudget } from '../moderation/budget';
import { cmsGlossary, glossaryFor, quranInText, resetGlossaryCache, translateAdminFieldsWithBudget } from '../captions/admin-fields';
import { handleInternalTranslate, parseInternalTranslate } from '../captions/inline';
import { FixtureTranslator, type Translator } from '../captions/translator';
import { miniQuranRows } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn(), request: jest.fn() } as never;
const index = new QuranIndex(QuranIndex.build(miniQuranRows(), 'v-test', new Date().toISOString()));
const IKHLAS = 'قل هو الله احد الله الصمد';
const env = { REPORTS_DB: {} as never, TRANSLATION_PROVIDER: 'fixture', INTERNAL_API_KEY: 'internal', ERRORS_INGEST_URL: 'https://admin.example/internal/errors', CMS_INTERNAL_URL: 'https://cms.example' };

/** Answers each item with `answer(text)` and keeps the prompts it was given. */
function scripted(answer: (text: string) => string) {
  const prompts: string[] = [];
  const translator: Translator = {
    provider: 'workers-ai',
    async translate(batch, from, to, ctx) {
      prompts.push(translationSystemPrompt(from, to, ctx));
      return batch.items.map((i) => ({ id: i.id, text: answer(i.text) }));
    },
  };
  return { translator, prompts };
}

const glossaryFetch = (entries: unknown[], status = 200) => jest.fn(async () => new Response(JSON.stringify({ entries }), { status })) as unknown as typeof fetch;

beforeEach(() => {
  resetGlossaryCache();
  (reserveBudget as jest.Mock).mockResolvedValue(true);
  globalThis.fetch = jest.fn(async () => new Response('{}')) as never;
});

describe('staff-set field translation', () => {
  it('puts the site wording («مرئي») and the matching CMS glossary entries in the prompt', async () => {
    const { translator, prompts } = scripted(() => 'مرئيات المحاضرات');
    const fetcher = glossaryFetch([{ source: 'Lectures', target: 'المحاضرات' }, { source: 'Unused', target: 'غير' }]);
    const out = await translateAdminFieldsWithBudget(env, { items: [{ id: 'a', text: 'Lectures and videos' }], from: 'en', to: 'ar', dailyBudgetUsd: 1 }, logger, undefined, { translator, index, fetcher });
    expect(out.items[0]).toEqual({ id: 'a', text: 'مرئيات المحاضرات' });
    expect(prompts[0]).toContain('«مرئي»');
    expect(prompts[0]).toContain('never «فيديو»');
    expect(prompts[0]).toContain('Lectures → المحاضرات');
    expect(prompts[0]).not.toContain('Unused');
    expect((fetcher as jest.Mock).mock.calls[0]![0]).toBe('https://cms.example/internal/glossary?from=en&to=ar');
    expect(new Headers((fetcher as jest.Mock).mock.calls[0]![1].headers).get('X-API-Key')).toBe('internal');
  });

  it('keeps placeholders exactly as written', async () => {
    const out = await translateAdminFieldsWithBudget(env, { items: [{ id: 'a', text: 'Hello {name}, you have {{count}} new videos (%s)' }], from: 'en', to: 'ar', dailyBudgetUsd: 1 }, logger, undefined, { translator: new FixtureTranslator(), index, fetcher: glossaryFetch([]) });
    expect(out.items[0]!.text).toContain('{name}');
    expect(out.items[0]!.text).toContain('{{count}}');
    expect(out.items[0]!.text).toContain('%s');
    expect(out.items[0]!.text).not.toMatch(/⟦Q\d+⟧/);
  });

  it('refuses Quran text: mushaf marks, a {…} quotation, a matcher hit, and the model’s own ⟦QURAN⟧ answer', async () => {
    const { translator } = scripted((text) => (text.startsWith('In the name of Allah') ? '⟦QURAN⟧' : 'ترجمة عادية هنا'));
    const items = [
      { id: 'mushaf', text: '﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾' },
      { id: 'brace', text: `تفسير {${IKHLAS}}` },
      { id: 'plain', text: IKHLAS },
      { id: 'english', text: 'In the name of Allah, the Most Gracious, the Most Merciful' },
      { id: 'ok', text: 'Upload guidelines' },
    ];
    const answers = await translateAdminFieldsWithBudget(env, { items: items.slice(0, 3), from: 'ar', to: 'en', dailyBudgetUsd: 1 }, logger, undefined, { translator: { provider: 'workers-ai', translate: jest.fn() }, index, fetcher: glossaryFetch([]) });
    for (const item of answers.items) expect(item).toMatchObject({ text: '', refused: 'quran' });
    expect(answers.items[1]!.quran?.[0]!.range).toMatch(/^112:1/);
    expect(answers.model).toBe('none');
    const en = await translateAdminFieldsWithBudget(env, { items: items.slice(3), from: 'en', to: 'ar', dailyBudgetUsd: 1 }, logger, undefined, { translator, index, fetcher: glossaryFetch([]) });
    expect(en.items[0]).toEqual({ id: 'english', text: '', refused: 'quran' });
    expect(en.items[1]).toEqual({ id: 'ok', text: 'ترجمة عادية هنا' });
  });

  it('a placeholder is not a quotation and ordinary Arabic is not Quran', () => {
    expect(quranInText(index, 'مرحبا {name}')).toBeNull();
    expect(quranInText(index, 'المرئيات الجديدة هذا الأسبوع')).toBeNull();
    expect(quranInText(index, 'ٱلْحَمْدُ ۝ ۖ ۗ')).not.toBeNull();
  });

  it('an unreachable glossary is logged and the text is translated without it; the answer is kept for 5 minutes', async () => {
    const fetcher = glossaryFetch([], 500);
    expect(await cmsGlossary(env, 'en', 'ar', logger, fetcher, 1000)).toEqual([]);
    const ok = glossaryFetch([{ source: 'Shorts', target: 'المقاطع القصيرة' }]);
    expect(await cmsGlossary(env, 'en', 'ar', logger, ok, 2000)).toEqual([]);
    expect(await cmsGlossary(env, 'en', 'ar', logger, ok, 1000 + 5 * 60_000 + 1)).toEqual([{ source: 'Shorts', target: 'المقاطع القصيرة' }]);
    expect(glossaryFor([{ source: 'a', target: 'x' }, { source: 'ab', target: 'y' }], ['AB c'])).toEqual([{ source: 'ab', target: 'y' }, { source: 'a', target: 'x' }]);
  });

  it('the internal route takes admin_field for en ↔ ar only, never DeepL, and a spent budget is 503', async () => {
    expect(parseInternalTranslate({ items: [{ id: 'a', text: 'x' }], from: 'en', to: 'fr', provider: 'workers-ai', dailyBudgetUsd: 1, mode: 'admin_field' })).toBeNull();
    expect(parseInternalTranslate({ items: [{ id: 'a', text: 'x' }], from: 'en', to: 'ar', provider: 'deepl', dailyBudgetUsd: 1, mode: 'admin_field' })?.provider).toBe('workers-ai');
    expect(parseInternalTranslate({ items: [{ id: 'a', text: 'x' }], from: 'en', to: 'ar', provider: 'workers-ai', dailyBudgetUsd: 1, mode: 'other' })).toBeNull();
    (reserveBudget as jest.Mock).mockResolvedValue(false);
    const res = await handleInternalTranslate(new Request('https://p/internal/translate', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', text: 'Hello' }], from: 'en', to: 'ar', provider: 'workers-ai', dailyBudgetUsd: 1, mode: 'admin_field' }) }), env as never, logger);
    expect(res.status).toBe(503);
  });

  it('under test the real Workers AI translator refuses to run (no AI spend)', async () => {
    const { WorkersAiTranslator } = await import('../captions/translator');
    expect(() => new WorkersAiTranslator({ run: jest.fn() }, { NODE_ENV: 'test' })).toThrow(/Refusing to call Workers AI/);
  });
});
