/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSiteTheme } from '../site-theme';

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
    global.fetch = global.fetch ?? jest.fn();
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
