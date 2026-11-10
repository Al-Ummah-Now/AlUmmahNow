/**
 * @jest-environment node
 */
import { SKEW_HOST_HEADER, withPublicHost } from '../skew-host';

describe('withPublicHost', () => {
  it('stamps the public host on requests to our domain, overwriting a client value', () => {
    const req = new Request('https://videos.alummahnow.net/en/upload', { headers: { [SKEW_HOST_HEADER]: 'evil.example' } });
    const out = withPublicHost(req);
    expect(out.headers.get(SKEW_HOST_HEADER)).toBe('videos.alummahnow.net');
    expect(out.url).toBe('https://videos.alummahnow.net/en/upload');
  });

  it('on an old version reached through its preview URL, puts the public host back', async () => {
    const req = new Request('https://1a2b3c4d-al-ummah-now-production.mahmoud-s-darwish.workers.dev/en/upload?x=1', {
      method: 'POST',
      headers: { [SKEW_HOST_HEADER]: 'videos.alummahnow.net', 'next-action': 'abc' },
      body: '["a"]',
    });
    const out = withPublicHost(req);
    expect(out.url).toBe('https://videos.alummahnow.net/en/upload?x=1');
    expect(out.headers.get('x-forwarded-host')).toBe('videos.alummahnow.net');
    expect(out.headers.get(SKEW_HOST_HEADER)).toBeNull();
    expect(out.headers.get('next-action')).toBe('abc');
    expect(out.method).toBe('POST');
    expect(await out.text()).toBe('["a"]');
  });

  it('ignores a forged host on a preview URL', () => {
    const req = new Request('https://1a2b3c4d-al-ummah-now-production.mahmoud-s-darwish.workers.dev/', { headers: { [SKEW_HOST_HEADER]: 'evil.example' } });
    expect(withPublicHost(req)).toBe(req);
    const lookalike = new Request('https://x.workers.dev/', { headers: { [SKEW_HOST_HEADER]: 'alummahnow.net.evil.example' } });
    expect(withPublicHost(lookalike)).toBe(lookalike);
  });

  it('leaves local development alone', () => {
    const req = new Request('http://localhost:3000/');
    expect(withPublicHost(req)).toBe(req);
  });
});
