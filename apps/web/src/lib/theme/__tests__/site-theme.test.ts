/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/lib/logger';
import { getSiteTheme, resetSiteThemeCache } from '../site-theme';

let waits: Promise<unknown>[] | null = null;
jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => {
    if (!waits) throw new Error('no Worker context');
    return { ctx: { waitUntil: (p: Promise<unknown>) => waits!.push(p) } };
  },
}));

describe('getSiteTheme', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });
  const answer = (body: unknown, ok = true) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);
  /** The setting answer, then the package CSS */
  const answers = (body: unknown, css: string | null) =>
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => body } as Response)
      .mockResolvedValueOnce({ ok: css !== null, text: async () => css ?? '' } as Response);
  /** The answer of every read after the ones already set */
  const answerLater = (body: unknown) => jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => body } as Response);
  const fawanees = { id: 'fawanees', css: null };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ACTIVE_THEME;
    process.env.ADMIN_API_URL = 'https://admin.test';
    resetSiteThemeCache();
    global.fetch = global.fetch ?? jest.fn();
    // Each read is a new 30 s window unless a test holds the clock (the setting is kept 30 s)
    let clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => (clock += 31_000));
  });

  it('reads the setting at most once per 30 s per isolate (prod: per-page reads timed out)', async () => {
    const t0 = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    const spy = answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 29_000);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
    expect(spy).toHaveBeenCalledTimes(1);
    answer({ theme: 'zujaj' });
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 31_000);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
  });

  it('is fawanees when the setting cannot be read', async () => {
    delete process.env.ADMIN_API_URL;
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
    process.env.ADMIN_API_URL = 'https://admin.test';
    answer({}, false);
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
  });

  it('uses the stored theme and rejects unknown ones', async () => {
    answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
    answer({ theme: 'neon' });
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
  });

  const pkg = { theme: 'eid-lights', package: { id: 'eid-lights', version: '1.0.0', css: 'https://admin.test/public/themes/eid-lights/1.0.0/theme.css' } };
  const css = "html[data-theme='eid-lights']{--m-page:none}";

  it('renders a published theme package with its compiled CSS', async () => {
    const spy = answers(pkg, css);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    expect(spy.mock.calls[1][0]).toBe(pkg.package.css);
  });

  it('falls back to fawanees when the package CSS is missing, foreign or unsafe', async () => {
    answers(pkg, null);
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
    answers(pkg, "html[data-theme='other']{}");
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
    answers(pkg, `${css}</style><script>alert(1)</script>`);
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
    answers({ theme: 'eid-lights' }, css);
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
  });

  it('keeps rendering the last theme when a read does not answer, not the default', async () => {
    answers(pkg, css);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    // The setting read times out or fails
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    answer({}, false);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    // A definite answer still wins
    answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
  });

  it('a slow answer or two is not a warning; a third in a row, or a refusal, is', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const slow = () => jest.spyOn(global, 'fetch').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    for (let i = 0; i < 2; i++) {
      slow();
      await expect(getSiteTheme()).resolves.toEqual(fawanees);
    }
    expect(warn).not.toHaveBeenCalled();
    slow();
    await getSiteTheme();
    expect(warn).toHaveBeenCalledTimes(1);
    // An answer starts the count again
    answer({ theme: 'nahas' });
    await getSiteTheme();
    slow();
    await getSiteTheme();
    expect(warn).toHaveBeenCalledTimes(1);
    answer({}, false);
    await getSiteTheme();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('reads a package version\'s CSS once', async () => {
    answers(pkg, css);
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    const spy = answer(pkg);
    spy.mockClear();
    await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
    // The setting only
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders the last theme while the package CSS cannot be read, the default once it is old', async () => {
    answer({ theme: 'zujaj' });
    await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => pkg } as Response)
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('down'));
    await expect(getSiteTheme()).resolves.toEqual(fawanees);
  });

  describe('on Workers', () => {
    const store = new Map<string, string>();
    const settled = async () => {
      while (waits!.length) await waits!.shift();
    };
    /** Another isolate in the same data centre */
    const newIsolate = () => resetSiteThemeCache();
    beforeEach(() => {
      waits = [];
      store.clear();
      (globalThis as { caches?: unknown }).caches = {
        default: {
          match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
          put: async (key: string, res: Response) => void store.set(key, await res.text()),
        },
      };
    });
    afterEach(() => {
      waits = null;
      delete (globalThis as { caches?: unknown }).caches;
    });

    it('a new isolate renders the kept theme without waiting for a slow admin-api', async () => {
      answer({ theme: 'nahas' });
      await getSiteTheme();
      await settled();
      newIsolate();
      let timedOut!: (e: Error) => void;
      const slow = jest.spyOn(global, 'fetch').mockClear().mockReturnValue(new Promise((_, no) => (timedOut = no)));
      await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
      expect(slow).toHaveBeenCalledTimes(1);
      timedOut(new DOMException('timed out', 'TimeoutError'));
      await settled();
    });

    it('a change is read after the page and shows on the next visit, in every isolate', async () => {
      answer({ theme: 'nahas' });
      await getSiteTheme();
      await settled();
      answer({ theme: 'zujaj' });
      await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
      await settled();
      newIsolate();
      await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
    });

    it('the first read of all waits a little, then the data centre keeps what came after', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
      answerLater({ theme: 'nahas' });
      await expect(getSiteTheme()).resolves.toEqual(fawanees);
      await settled();
      newIsolate();
      await expect(getSiteTheme()).resolves.toEqual({ id: 'nahas', css: null });
    });

    it('a theme taken away falls back to the default on the next visit; one kept for too long is not used', async () => {
      answers(pkg, css);
      await getSiteTheme();
      await settled();
      answer({ theme: 'eid-lights' });
      await expect(getSiteTheme()).resolves.toEqual({ id: 'eid-lights', css });
      await settled();
      await expect(getSiteTheme()).resolves.toEqual(fawanees);
      await settled();
      newIsolate();
      store.set([...store.keys()][0], JSON.stringify({ theme: { id: 'nahas', css: null }, at: 1 }));
      answer({ theme: 'zujaj' });
      await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
      await settled();
    });

    it('one background read at a time', async () => {
      answer({ theme: 'nahas' });
      const t0 = 1_800_000_000_000;
      const at = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(t0 + ms);
      at(0);
      await getSiteTheme();
      await settled();
      const spy = answer({ theme: 'nahas' });
      spy.mockClear();
      at(40_000);
      await Promise.all([getSiteTheme(), getSiteTheme(), getSiteTheme()]);
      expect(spy).toHaveBeenCalledTimes(1);
      await settled();
    });
  });

  it('lets a build-time theme win, without a request', async () => {
    process.env.NEXT_PUBLIC_ACTIVE_THEME = 'zujaj';
    const fetchSpy = answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toEqual({ id: 'zujaj', css: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('site-themes.css', () => {
  it('scopes every theme and makes fawanees the fallback', () => {
    const css = readFileSync(join(process.cwd(), 'src/theme/site-themes.css'), 'utf8');
    for (const id of ['lantern', 'zujaj', 'nahas']) expect(css).toContain(`html[data-theme='${id}'] {`);
    expect(css).toContain(":root, html[data-theme='fawanees'] {");
  });
});
