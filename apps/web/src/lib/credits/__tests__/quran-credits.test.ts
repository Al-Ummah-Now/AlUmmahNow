/**
 * The Credits page's read of GET /api/quran/credits.
 */
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
import { loadQuranCredits } from '../quran-credits';

/** jsdom has no Response: the few members the loader reads */
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const data = { attribution: { en: 'a', ar: 'b' }, credit: { en: 'c', ar: 'd', url: 'https://quran.foundation/' }, quranText: true, editions: [{ id: 20, name: 'Saheeh International', language: 'en' }] };

describe('loadQuranCredits', () => {
  it('ok: the API’s editions', async () => {
    const f = jest.fn(async () => reply({ success: true, data }));
    const r = await loadQuranCredits(f as unknown as typeof fetch);
    expect(r).toEqual({ status: 'ok', credits: data });
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/quran\/credits$/);
  });

  it('404 feature_off: off (the page is a 404)', async () => {
    const r = await loadQuranCredits((async () => reply({ success: false, code: 'feature_off' }, 404)) as unknown as typeof fetch);
    expect(r).toEqual({ status: 'off' });
  });

  it('API down: QF’s line from the shared text, no editions', async () => {
    const r = await loadQuranCredits((async () => { throw new Error('down'); }) as unknown as typeof fetch);
    expect(r.status).toBe('error');
    if (r.status === 'error') {
      expect(r.credits.attribution.en).toBe('Quran data provided by Quran Foundation (https://quran.foundation/)');
      expect(r.credits.editions).toEqual([]);
    }
  });
});
