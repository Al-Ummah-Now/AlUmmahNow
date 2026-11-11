/**
 * Story 1.2 AC 3, 6: CSP blocks inline/injected scripts and eval in production.
 */
import { buildContentSecurityPolicy, generateNonce, SECURITY_HEADERS, serializeForInlineScript, CSP_REPORT_PATH } from '../csp';

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(';').map(part => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

const env = {
  apiUrl: 'https://videos.api.qa.alummahnow.net',
  websocketUrl: 'wss://realtime.qa.alummahnow.net/ws',
  bunnyPullZone: 'vz-123.b-cdn.net',
  authUrl: 'https://auth.qa.alummahnow.net',
};

describe('buildContentSecurityPolicy (production)', () => {
  const nonce = 'dGVzdC1ub25jZQ==';
  const d = directives(buildContentSecurityPolicy({ isDevelopment: false, nonce, env }));

  it('requires the per-request nonce and strict-dynamic for scripts', () => {
    expect(d['script-src']).toEqual(expect.arrayContaining([`'nonce-${nonce}'`, "'strict-dynamic'"]));
  });

  it('never allows eval', () => {
    expect(d['script-src']).not.toContain("'unsafe-eval'");
  });

  it('forbids inline event handler attributes and plugins', () => {
    expect(d['script-src-attr']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
  });

  it('restricts connections to the configured backends', () => {
    expect(d['connect-src']).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://videos.api.qa.alummahnow.net',
        'wss://realtime.qa.alummahnow.net',
        'https://vz-123.b-cdn.net',
        'https://auth.qa.alummahnow.net',
      ]),
    );
    expect(d['connect-src']).not.toContain('http://localhost:*');
  });

  it('allows the self-hosted live edges for live HLS (fetched and played natively)', () => {
    expect(d['connect-src']).toEqual(expect.arrayContaining(['https://live.alummahnow.net', 'https://live.qa.alummahnow.net']));
    expect(d['media-src']).toEqual(expect.arrayContaining(['https://live.stage.alummahnow.net']));
  });

  it('reports violations and upgrades insecure requests', () => {
    expect(d['report-uri']).toEqual([CSP_REPORT_PATH]);
    expect(d['upgrade-insecure-requests']).toEqual([]);
  });

  it('does not allow third-party analytics script hosts', () => {
    expect(d['script-src'].join(' ')).not.toMatch(/cloudflareinsights|google-analytics|googletagmanager/);
  });
});

describe('buildContentSecurityPolicy (a page served over plain http)', () => {
  it('does not upgrade insecure requests (WebKit would upgrade localhost subresources to https)', () => {
    const d = directives(buildContentSecurityPolicy({ isDevelopment: false, insecureOrigin: true, env }));
    expect(d['upgrade-insecure-requests']).toBeUndefined();
    expect(d['report-uri']).toEqual([CSP_REPORT_PATH]);
  });
});

describe('buildContentSecurityPolicy (development)', () => {
  it('keeps eval for the Next.js dev server and allows localhost', () => {
    const d = directives(buildContentSecurityPolicy({ isDevelopment: true, env }));
    expect(d['script-src']).toContain("'unsafe-eval'");
    expect(d['connect-src']).toContain('http://localhost:*');
    expect(d['upgrade-insecure-requests']).toBeUndefined();
  });
});

describe('helpers', () => {
  it('generates distinct 128-bit nonces', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });

  it('serializes inline script data without allowing script breakout', () => {
    const out = serializeForInlineScript({ API_URL: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ API_URL: '</script><script>alert(1)</script>' });
  });

  it('disables the legacy XSS auditor and sets hardening headers', () => {
    expect(SECURITY_HEADERS['X-XSS-Protection']).toBe('0');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
  });
});
