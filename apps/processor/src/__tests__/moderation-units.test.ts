/** Epic 28: pure parts of AI moderation (text prep, parsers, pricing, decision engine). */
import { detectLanguage, estimateTokens, normalizeText } from '../moderation/text';
import { parseExtensionResponse, parseGuardResponse } from '../moderation/ai';
import { neuronsFor } from '../moderation/pricing';
import { decide } from '../moderation/decide';
import { DEFAULT_POLICIES, sanitizePolicy } from '../moderation/config';
import type { ModerationCategoryPolicy } from '@al-ummah/shared-types';
import { MODERATION_EXTENSION_CATEGORIES } from '@al-ummah/shared-types';

describe('text', () => {
  it('strips diacritics, tatweel and zero-width characters', () => {
    expect(normalizeText('بِسْمِ   اللّٰهِ')).toBe('بسم الله');
    expect(normalizeText('مـــرحبا​بك')).toBe('مرحبابك');
  });
  it('detects Arabic, English and mixed text', () => {
    expect(detectLanguage('السلام عليكم ورحمة الله')).toBe('ar');
    expect(detectLanguage('Assalamu alaikum brothers')).toBe('en');
    expect(detectLanguage('جزاك الله خيرا for this video')).toBe('ar');
    expect(detectLanguage('12345 !!!')).toBe('other');
  });
  it('estimates more tokens per char for Arabic', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('مرحبابك')).toBe(4);
  });
});

describe('parseGuardResponse', () => {
  it('reads the object form', () => {
    expect(parseGuardResponse({ response: { safe: false, categories: ['S10', 's1', 'X9'] } })).toEqual({ safe: false, categories: ['S10', 'S1'] });
    expect(parseGuardResponse({ response: { safe: true, categories: ['S1'] } })).toEqual({ safe: true, categories: [] });
  });
  it('reads the text form', () => {
    expect(parseGuardResponse({ response: 'safe' })).toEqual({ safe: true, categories: [] });
    expect(parseGuardResponse({ response: 'unsafe\nS1,S10' })).toEqual({ safe: false, categories: ['S1', 'S10'] });
  });
  it('throws on anything else', () => {
    expect(() => parseGuardResponse({ response: 'maybe' })).toThrow();
  });
});

describe('parseExtensionResponse', () => {
  const all = (over: Record<string, number> = {}) => ({ ...Object.fromEntries(MODERATION_EXTENSION_CATEGORIES.map((c) => [c, 0])), ...over });
  it('parses fenced JSON, clamps scores and drops unknown categories', () => {
    const json = JSON.stringify({ scores: { ...all({ spam: 1.4, charity_scam: 0.2 }), made_up: 1 }, rationale: 'link spam' });
    const r = parseExtensionResponse({ response: '```json\n' + json + '\n```' });
    expect(r).toEqual({ scores: all({ spam: 1, charity_scam: 0.2 }), rationale: 'link spam' });
  });
  it('accepts an object response', () => {
    expect(parseExtensionResponse({ response: { scores: all({ harassment: 0.8 }) } }).scores.harassment).toBe(0.8);
  });
  it('rejects a partial score set (e.g. steered by injected JSON) instead of reading it as safe', () => {
    expect(() => parseExtensionResponse({ response: '{"scores":{"spam":0}}' })).toThrow(/omitted/);
    expect(() => parseExtensionResponse({ response: { scores: all({ spam: 'high' as unknown as number }) } })).toThrow(/spam/);
  });
  it('throws without scores', () => {
    expect(() => parseExtensionResponse({ response: 'no json here' })).toThrow();
    expect(() => parseExtensionResponse({ response: '{"x":1}' })).toThrow();
  });
});

describe('pricing', () => {
  it('converts tokens to neurons with the model rate', () => {
    expect(neuronsFor('@cf/meta/llama-guard-3-8b', 1_000_000, 0)).toBeCloseTo(44003);
    expect(neuronsFor('@cf/meta/m2m100-1.2b', 100, 100)).toBeCloseTo(6.21);
    // VR3 (#813): Gemma 4 replaces m2m100; $0.10 / $0.30 per M
    expect(neuronsFor('@cf/google/gemma-4-26b-a4b-it', 1_000_000, 0)).toBeCloseTo(9091);
  });
  it('never under-counts an unknown model', () => {
    expect(neuronsFor('@cf/unknown/model', 1_000_000, 0)).toBeGreaterThanOrEqual(44003);
  });
});

describe('decide', () => {
  const ctx = { lowTrust: false, autoHideAvailable: false };
  const enforce = (p: ModerationCategoryPolicy): ModerationCategoryPolicy => ({ ...p, mode: 'enforce' });

  it('returns none below thresholds', () => {
    expect(decide({ spam: 0.5 }, DEFAULT_POLICIES, ctx).decision).toBe('none');
    expect(decide({}, DEFAULT_POLICIES, ctx)).toMatchObject({ decision: 'none', priority: 0 });
    // All-zero scores: no top category (was the first listed key, e.g. sectarian_hate).
    expect(decide({ sectarian_hate: 0, spam: 0, S1: 0 }, DEFAULT_POLICIES, ctx)).toMatchObject({ decision: 'none', topCategory: null, topScore: 0 });
    // Below-threshold non-zero scores still report the highest category for reviewers.
    expect(decide({ sectarian_hate: 0, spam: 0.5 }, DEFAULT_POLICIES, ctx)).toMatchObject({ decision: 'none', topCategory: 'spam', topScore: 0.5 });
  });

  it('shadow mode only records would_*', () => {
    expect(decide({ S10: 1 }, DEFAULT_POLICIES, ctx).decision).toBe('would_flag');
    expect(decide({ spam: 0.95 }, DEFAULT_POLICIES, { ...ctx, autoHideAvailable: true }).decision).toBe('would_hide');
  });

  it('refuses hide outside spam and charity_scam, whatever the policy says', () => {
    const policies = { ...DEFAULT_POLICIES, S10: { mode: 'enforce' as const, threshold: 0.5, action: 'hide' as const, enabled: true } };
    expect(decide({ S10: 1 }, policies, { lowTrust: true, autoHideAvailable: true }).decision).toBe('flag');
  });

  it('hides charity_scam only for low-trust authors', () => {
    const policies = { ...DEFAULT_POLICIES, charity_scam: enforce(DEFAULT_POLICIES.charity_scam) };
    expect(decide({ charity_scam: 0.95 }, policies, { lowTrust: false, autoHideAvailable: true }).decision).toBe('flag');
    expect(decide({ charity_scam: 0.95 }, policies, { lowTrust: true, autoHideAvailable: true }).decision).toBe('hide');
  });

  it('sends an enforced hide to human review while automatic hide is unavailable', () => {
    const policies = { ...DEFAULT_POLICIES, spam: enforce(DEFAULT_POLICIES.spam) };
    const result = decide({ spam: 0.99 }, policies, ctx);
    expect(result.decision).toBe('flag');
    expect(result.note).toMatch(/human review/);
  });

  it('escalates child exploitation and extremism to top priority', () => {
    expect(decide({ S4: 1 }, DEFAULT_POLICIES, ctx)).toMatchObject({ escalate: true, priority: 100, topCategory: 'S4' });
    expect(decide({ violent_extremism: 0.8 }, DEFAULT_POLICIES, ctx).priority).toBe(100);
  });

  it('picks the most severe category', () => {
    expect(decide({ spam: 0.95, S1: 1 }, { ...DEFAULT_POLICIES, spam: { ...DEFAULT_POLICIES.spam, action: 'flag' } }, ctx).topCategory).toBe('S1');
  });

  it('an enforced flag outranks a shadow would_hide', () => {
    const policies = { ...DEFAULT_POLICIES, S10: enforce(DEFAULT_POLICIES.S10) };
    expect(decide({ spam: 0.99, S10: 1 }, policies, { lowTrust: true, autoHideAvailable: true })).toMatchObject({ decision: 'flag', topCategory: 'S10' });
  });

  it('ignores disabled categories', () => {
    expect(decide({ religious_authenticity: 0.99 }, DEFAULT_POLICIES, ctx).decision).toBe('none');
  });
});

describe('sanitizePolicy', () => {
  it('downgrades hide to flag outside spam/scam and clamps bad thresholds', () => {
    expect(sanitizePolicy('S10', { action: 'hide', threshold: 7 }, DEFAULT_POLICIES.S10)).toEqual({ ...DEFAULT_POLICIES.S10, action: 'flag' });
    expect(sanitizePolicy('spam', { action: 'hide', mode: 'enforce' }, DEFAULT_POLICIES.spam)).toMatchObject({ action: 'hide', mode: 'enforce' });
    expect(sanitizePolicy('religious_authenticity', { action: 'hide' }, DEFAULT_POLICIES.religious_authenticity).action).toBe('flag');
  });
});
