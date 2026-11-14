/**
 * @jest-environment node
 */
import { GET } from '../route';

/**
 * A published theme package's files, served from this origin: its assets, and its art per mode (the
 * sign-in banner's, art/<mode>.svg, written by admin-api with the theme's colours in). Nothing else.
 */
const get = (file: string, id = 'my-theme', version = '1.0.1') => GET(new Request(`https://videos.test/api/theme-packages/${id}/${version}/${file}`), { params: Promise.resolve({ id, version, path: file.split('/') }) });

describe('GET /api/theme-packages/:id/:version/*', () => {
  const realFetch = global.fetch;
  let calls: string[];
  beforeEach(() => {
    process.env.ADMIN_API_URL = 'https://admin-api.test';
    calls = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
    }) as typeof fetch;
  });
  afterAll(() => { global.fetch = realFetch; });

  it('serves the art of each mode, as an SVG locked down by its own CSP, cached for good', async () => {
    for (const mode of ['light', 'dark']) {
      const res = await get(`art/${mode}.svg`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    }
    expect(calls).toEqual(['https://admin-api.test/public/themes/my-theme/1.0.1/art/light.svg', 'https://admin-api.test/public/themes/my-theme/1.0.1/art/dark.svg']);
  });

  it('serves assets, and refuses any other path without asking admin-api', async () => {
    expect((await get('assets/sky.svg')).status).toBe(200);
    for (const file of ['art/other.svg', 'art/dark.png', 'theme.json', 'theme.css', 'assets/../theme.json']) expect((await get(file)).status).toBe(404);
    expect((await get('art/dark.svg', 'Bad_Id')).status).toBe(404);
    expect(calls).toEqual(['https://admin-api.test/public/themes/my-theme/1.0.1/assets/sky.svg']);
  });
});
