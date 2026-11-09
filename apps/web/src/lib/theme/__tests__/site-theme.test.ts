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

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ACTIVE_THEME;
    process.env.ADMIN_API_URL = 'https://admin.test';
    global.fetch = global.fetch ?? jest.fn();
  });

  it('is fawanees when the setting cannot be read', async () => {
    delete process.env.ADMIN_API_URL;
    await expect(getSiteTheme()).resolves.toBe('fawanees');
    process.env.ADMIN_API_URL = 'https://admin.test';
    answer({}, false);
    await expect(getSiteTheme()).resolves.toBe('fawanees');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(getSiteTheme()).resolves.toBe('fawanees');
  });

  it('uses the stored theme and rejects unknown ones', async () => {
    answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toBe('nahas');
    answer({ theme: 'neon' });
    await expect(getSiteTheme()).resolves.toBe('fawanees');
  });

  it('lets a build-time theme win, without a request', async () => {
    process.env.NEXT_PUBLIC_ACTIVE_THEME = 'zujaj';
    const fetchSpy = answer({ theme: 'nahas' });
    await expect(getSiteTheme()).resolves.toBe('zujaj');
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
