/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/lib/logger';
import { getSiteTheme, resetSiteThemeCache } from '../site-theme';

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
