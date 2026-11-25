/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStaticFile, markStaticFile, STATIC_FILE_HEADER } from '../static-file';

describe('a request for a file', () => {
  it.each(['/_next/static/chunks/1.js', '/_next/static/chunks/1.js.map', '/_next/image', '/en/_next/static/x', '/manifest.webmanifest', '/wp-login.php', '/codecov.yml', '/icon.PNG'])('%s is one', (path) => {
    expect(isStaticFile(path)).toBe(true);
    expect(markStaticFile(new Request(`https://videos.alummahnow.net${path}`)).headers.get(STATIC_FILE_HEADER)).toBe('1');
  });

  it.each(['/', '/en', '/ar/video/12345678', '/en/@some.handle', '/embed/v/1'])('%s is a page, whatever the client says', (path) => {
    expect(isStaticFile(path)).toBe(false);
    const asked = new Request(`https://videos.alummahnow.net${path}`, { headers: { [STATIC_FILE_HEADER]: '1' } });
    expect(markStaticFile(asked).headers.has(STATIC_FILE_HEADER)).toBe(false);
  });

  it('keeps the body and method, and the layout reads no theme for it', async () => {
    const out = markStaticFile(new Request('https://videos.alummahnow.net/x.json', { method: 'POST', body: 'a' }));
    expect([out.method, await out.text()]).toEqual(['POST', 'a']);
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    expect(read('worker.ts')).toContain('markStaticFile(request)');
    expect(read('src/app/layout.tsx')).toMatch(/requestHeaders\.has\(STATIC_FILE_HEADER\) \? defaultSiteTheme : await getSiteTheme\(\)/);
  });
});
