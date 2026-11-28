/**
 * Regression test suite for the apps/web injection audit (docs/security/injection-audit-web.md).
 *
 * Covers:
 * - URL & protocol allowlisting (XSS via javascript:/data:/vbscript:/protocol-relative)
 * - Open redirects & Host header injection
 * - Path traversal & SSRF in API paths, site-domains, watch-time/retention, and media redirects
 * - XML sitemap, JSON-LD, CSS package, header, and log injection
 * - Valibot schema validation for route handlers and server actions
 */

import * as v from 'valibot';
import {
  encodePathSegment,
  isLocalHostHeader,
  jsonObjectSchema,
  qoeBeaconSchema,
  safeHostHeader,
  safeHostname,
  safeHttpUrl,
  safeImageUrl,
  safeMailtoHref,
  safeNavigationUrl,
  safePathSegment,
  safeSameOriginPath,
  sanitizeHeaderValue,
  sanitizeLogText,
  siteDomainHostBodySchema,
  translateTextsSchema,
  createModerationReportSchema,
  errorReportEnvelopeSchema,
  videoAnalyticsBatchSchema,
} from '@/lib/security/safe-input';
import { resolveUrl } from '@/lib/utility';
import { captionDownloadHref, toPlayerTextTracks } from '@/lib/video/subtitle-tracks';
import { resolveHref } from '@/lib/about/markdown';
import { escapeHtmlAttr, iframeSnippet, responsiveSnippet } from '@/lib/embed/snippets';
import { localizeActionUrl } from '@/lib/notifications/render';
import { originFromHost } from '@/lib/embed/request-origin';
import { legacyWatchRedirect } from '@/lib/seo/robots';
import { upstreamPath } from '@/lib/studio/site-domains';
import { watchTimeReports } from '@/lib/video/watch-time';
import { retentionReports } from '@/lib/video/retention';
import { sitemapIndexXml, videosSitemapXml } from '@/lib/seo/sitemaps';
import { jsonLdText } from '@/lib/seo/structured-data';
import { normalizeCspReports, normalizeSecurityEvents } from '@/lib/security/security-report';
import { apiSegment, buildApiUrl } from '@/lib/api/api-client';
import { fetchAllowedImageSource } from '@/lib/embed/share-image';
import { listReturn } from '@/lib/studio/list-return';

describe('safe-input URL & protocol allowlisting (XSS prevention)', () => {
  it('allows valid http(s) URLs and blocks javascript:, data:, vbscript:, control chars, and protocol-relative', () => {
    expect(safeHttpUrl('https://example.com/path?a=1')).toBe('https://example.com/path?a=1');
    expect(safeHttpUrl('http://localhost:3000/a')).toBe('http://localhost:3000/a');
    expect(safeHttpUrl('http://example.com', { allowHttp: false })).toBeNull();

    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' \tjavascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.example/x',
      '/relative/path',
      'https://example.com/\r\nSet-Cookie: a=1',
      '',
      null,
    ]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });

  it('validates image URLs and rejects SVG/HTML data URIs and script schemes', () => {
    expect(safeImageUrl('https://cdn.example.com/a.webp')).toBe('https://cdn.example.com/a.webp');
    expect(safeImageUrl('/images/logo.png')).toBe('/images/logo.png');
    expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=', { allowDataImage: true })).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );

    expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zy8+', { allowDataImage: true })).toBeNull();
    expect(safeImageUrl('data:text/html,<script>alert(1)</script>', { allowDataImage: true })).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl('//evil.example/a.png')).toBeNull();
    expect(safeImageUrl('/\\evil.example/a.png')).toBeNull();
  });

  it('validates mailto hrefs and blocks header/control injection', () => {
    expect(safeMailtoHref('contact@alummahnow.net')).toBe('mailto:contact@alummahnow.net');
    expect(safeMailtoHref('user@example.com?subject=evil')).toBeNull();
    expect(safeMailtoHref('user@example.com\r\nBcc:victim@example.com')).toBeNull();
    expect(safeMailtoHref('javascript:alert(1)')).toBeNull();
  });

  it('validates navigation URLs for window.location.assign', () => {
    expect(safeNavigationUrl('https://billing.stripe.com/session/1')).toBe('https://billing.stripe.com/session/1');
    expect(safeNavigationUrl('/en/upgrade?checkout=1', { allowRelative: true })).toBe('/en/upgrade?checkout=1');
    expect(safeNavigationUrl('javascript:alert(1)', { allowRelative: true })).toBeNull();
    expect(safeNavigationUrl('data:text/html,hi', { allowRelative: true })).toBeNull();
    expect(safeNavigationUrl('//evil.example', { allowRelative: true })).toBeNull();
    expect(safeNavigationUrl('/\\evil.example', { allowRelative: true })).toBeNull();
  });

  it('hardens resolveUrl against dangerous data:, javascript:, http-prefix tricks, and //', () => {
    expect(resolveUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(resolveUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe('');
    expect(resolveUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(resolveUrl('javascript:alert(1)')).toBe('');
    expect(resolveUrl('httpx:alert(1)')).toBe('');
    expect(resolveUrl('//evil.example/x.png', 'https://alummahnow.net')).toBe('');
    expect(resolveUrl('/\\evil.example/x.png', 'https://alummahnow.net')).toBe('');
  });

  it('hardens captionDownloadHref and toPlayerTextTracks against javascript: URIs', () => {
    expect(captionDownloadHref('javascript:alert(1)//api/videos/v1/subtitles/en')).toBeNull();
    expect(captionDownloadHref('data:text/html,/api/videos/v1/subtitles/en')).toBeNull();
    expect(captionDownloadHref('https://videos.api.test/api/videos/v1/subtitles/en')).toBe(
      'https://videos.api.test/api/videos/v1/subtitles/en/download',
    );

    const tracks = toPlayerTextTracks(
      [
        { language: 'en', url: 'javascript:alert(1)', status: 'ready' },
        { language: 'ar', url: '//evil.example/track.vtt', status: 'ready' },
        { language: 'fr', url: '/api/videos/v1/subtitles/fr', status: 'ready' },
      ],
      { apiUrl: 'https://api.example.com', videoId: 'v1', uiLocale: 'en' },
    );
    expect(tracks.map((t) => t.srclang)).toEqual(['fr']);
  });

  it('hardens About markdown resolveHref and embed iframe snippets', () => {
    const ctx = { wwwUrl: 'https://www.alummahnow.net', locale: 'en' as const };
    expect(resolveHref('/\\evil.example', ctx)).toBeNull();
    expect(resolveHref('mailto:bad@example.com?bcc=a', ctx)).toBeNull();
    expect(resolveHref('mailto:info@alummahnow.net', ctx)).toEqual({
      href: 'mailto:info@alummahnow.net',
      external: true,
    });
    expect(resolveHref('#section-1', ctx)).toEqual({ href: '#section-1', external: false });
    expect(resolveHref('#" onmouseover="alert(1)', ctx)).toBeNull();

    expect(escapeHtmlAttr(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
    expect(iframeSnippet('javascript:alert(1)', { width: 560, height: 315 }, 'T')).toContain('src="about:blank"');
    expect(responsiveSnippet('data:text/html,<script>', 'T')).toContain('src="about:blank"');
  });
});

describe('Open redirect & Host header injection prevention', () => {
  it('blocks backslash, protocol-relative, and control chars in same-origin paths and notifications', () => {
    expect(safeSameOriginPath('/en/studio/ch1')).toBe('/en/studio/ch1');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/ok\r\nLocation: //evil']) {
      expect(safeSameOriginPath(bad)).toBeNull();
      expect(localizeActionUrl(bad, 'en')).toBeNull();
    }
    expect(localizeActionUrl('/video/123', '../evil')).toBe('/en/video/123');
    expect(localizeActionUrl('/video/123', 'ar')).toBe('/ar/video/123');
  });

  it('rejects untrusted sessionStorage URLs in studio listReturn', () => {
    sessionStorage.setItem('studio:list-return', JSON.stringify({ channelId: 'ch1', url: '//evil.example/phish', target: '/en/studio/ch1/edit' }));
    expect(listReturn('ch1', '/en/studio/ch1/edit')).toBeNull();
    sessionStorage.setItem('studio:list-return', JSON.stringify({ channelId: 'ch1', url: '/\\evil.example', target: '/en/studio/ch1/edit' }));
    expect(listReturn('ch1', '/en/studio/ch1/edit')).toBeNull();
    sessionStorage.setItem('studio:list-return', JSON.stringify({ channelId: 'ch1', url: '/en/studio/ch1/content?tab=videos', target: '/en/studio/ch1/edit' }));
    expect(listReturn('ch1', '/en/studio/ch1/edit')).toEqual({
      url: '/en/studio/ch1/content?tab=videos',
      cameFromList: true,
    });
  });

  it('validates Host headers strictly in originFromHost and isLocalHostHeader', () => {
    expect(originFromHost('videos.alummahnow.net')).toBe('https://videos.alummahnow.net');
    expect(originFromHost('localhost:3000')).toBe('http://localhost:3000');
    expect(originFromHost('evil.example@alummahnow.net')).toBe('http://localhost');
    expect(originFromHost('alummahnow.net/evil')).toBe('http://localhost');
    expect(originFromHost('alummahnow.net\r\nX-Injected: 1')).toBe('http://localhost');

    expect(isLocalHostHeader('localhost')).toBe(true);
    expect(isLocalHostHeader('localhost:3001')).toBe(true);
    expect(isLocalHostHeader('127.0.0.1:3000')).toBe(true);
    expect(isLocalHostHeader('evil-localhost.attacker.com')).toBe(false);
    expect(isLocalHostHeader('localhost.attacker.com')).toBe(false);
    expect(safeHostHeader('good.example.com:443')).toBe('good.example.com:443');
    expect(safeHostHeader('bad host')).toBeNull();
  });

  it('rejects dot traversal and invalid locales in legacyWatchRedirect', () => {
    expect(legacyWatchRedirect('/en/video', new URLSearchParams('vid=abc123&t=10'), 'en')).toBe('/en/video/abc123?t=10');
    expect(legacyWatchRedirect('/en/video', new URLSearchParams('vid=..'), 'en')).toBeNull();
    expect(legacyWatchRedirect('/en/video', new URLSearchParams('vid=.'), 'en')).toBeNull();
    expect(legacyWatchRedirect('/en/video', new URLSearchParams('vid=abc\r\nSet-Cookie:x=1'), 'en')).toBeNull();
    expect(legacyWatchRedirect('/xx/video', new URLSearchParams('vid=abc123'), 'en')).toBeNull();
  });
});

describe('SSRF, path traversal, and redirect-host enforcement', () => {
  it('blocks dot-dot traversal in site-domains upstreamPath and safeHostname', () => {
    expect(upstreamPath('DELETE', 'ch1', ['..'])).toBeNull();
    expect(upstreamPath('POST', 'ch1', ['..', 'refresh'])).toBeNull();
    expect(upstreamPath('DELETE', 'ch1', ['bad..example.com'])).toBeNull();
    expect(upstreamPath('DELETE', 'ch1', ['.example.com'])).toBeNull();
    expect(upstreamPath('DELETE', 'ch1', ['scholar.example.com'])).toBe(
      '/internal/site-domains/ch1/domains/scholar.example.com',
    );
    expect(safeHostname('..')).toBeNull();
    expect(safeHostname('a..b.com')).toBeNull();
  });

  it('blocks path traversal in apiSegment and buildApiUrl', () => {
    expect(safePathSegment('..')).toBeNull();
    expect(safePathSegment('.')).toBeNull();
    expect(safePathSegment('a/b')).toBeNull();
    expect(safePathSegment('a?b=1')).toBeNull();
    expect(safePathSegment('a#b')).toBeNull();
    expect(encodePathSegment('vid-123')).toBe('vid-123');

    expect(() => apiSegment('../admin')).toThrow('Invalid API path segment');
    expect(() => apiSegment('..')).toThrow('Invalid API path segment');
    expect(() => buildApiUrl('/api/videos/../../admin')).toThrow('Invalid API path');
    expect(() => buildApiUrl('//evil.example/api')).toThrow('Invalid API path');
    expect(() => buildApiUrl('/api/videos/\r\nX: 1')).toThrow('Invalid API path');
  });

  it('blocks invalid videoIds in watchTimeReports and retentionReports', () => {
    expect(
      watchTimeReports([
        { eventType: 'watch_time', videoId: '../../admin', sessionId: 's1', data: { seconds: 10 } },
        { eventType: 'watch_time', videoId: 'v1?foo=bar', sessionId: 's1', data: { seconds: 10 } },
        { eventType: 'watch_time', videoId: 'valid-id-1', sessionId: 's1', data: { seconds: 10 } },
      ]),
    ).toEqual([{ videoId: 'valid-id-1', sessionId: 's1', seconds: 10 }]);

    expect(
      retentionReports([
        { eventType: 'retention', videoId: '../../admin', sessionId: 's1', data: { buckets: [0, 1] } },
        { eventType: 'retention', videoId: 'valid-id-1', sessionId: 's1', data: { buckets: [0, 1] } },
      ]),
    ).toEqual([{ videoId: 'valid-id-1', sessionId: 's1', buckets: [0, 1] }]);
  });

  it('blocks SSRF redirects to disallowed hosts in fetchAllowedImageSource', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const mockRes = (status: number, location?: string) => ({
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'location' ? (location ?? null) : null) },
    });
    try {
      fetchMock.mockResolvedValueOnce(mockRes(302, 'http://169.254.169.254/latest/meta-data/'));
      const blocked = await fetchAllowedImageSource('https://images.alummahnow.net/a.jpg');
      expect(blocked).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(mockRes(302, 'https://cdn.alummahnow.net/b.jpg'))
        .mockResolvedValueOnce(mockRes(200));
      const allowed = await fetchAllowedImageSource('https://images.alummahnow.net/a.jpg');
      expect(allowed?.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('XML, JSON-LD, header, log, and Valibot schema hardening', () => {
  it('blocks XML injection via sitemap lastModified and publishedAt timestamps', () => {
    const poisoned = '2026-11-10</lastmod><url><loc>https://evil.example</loc></url>';
    const indexXml = sitemapIndexXml('https://videos.alummahnow.net', {
      pageSize: 2000,
      kinds: { videos: { count: 1, pages: 1, lastModified: poisoned } },
    });
    expect(indexXml).not.toContain('evil.example');

    const videoXml = videosSitemapXml('https://videos.alummahnow.net', [
      {
        id: 'v1',
        title: 'Safe',
        duration: 60,
        isLive: false,
        publishedAt: '2026-11-10</video:publication_date><evil/>',
        lastModified: poisoned,
      },
    ]);
    expect(videoXml).not.toContain('<evil/>');
    expect(videoXml).not.toContain('evil.example');
  });

  it('escapes <, >, &, and Unicode line separators in jsonLdText', () => {
    const out = jsonLdText({ name: '</script><script>alert(1)&</script>\u2028\u2029' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)&</script>\u2028\u2029' });
  });

  it('strips CR/LF from forwarded headers and collapses newlines in log values', () => {
    expect(sanitizeHeaderValue('203.0.113.5\r\nX-Injected: yes')).toBe('203.0.113.5X-Injected: yes');
    expect(sanitizeHeaderValue('\r\n\0')).toBeUndefined();
    expect(sanitizeLogText('line1\r\n[ERROR] forged\nline2')).toBe('line1 [ERROR] forged line2');

    const events = normalizeSecurityEvents({
      events: [{ type: 'csp_violation', severity: 'high', reason: 'bad\r\nforged', path: '/a\nb?secret=1' }],
    });
    expect(events[0].reason).not.toMatch(/[\r\n]/);
    expect(events[0].path).toBe('/a b');

    const csp = normalizeCspReports({
      'csp-report': { 'effective-directive': 'script-src\r\nforged', 'blocked-uri': 'https://evil.example/x?k=1' },
    });
    expect(csp[0].directive).not.toMatch(/[\r\n]/);
  });

  it('enforces Valibot schemas for route handlers and server actions', () => {
    expect(v.safeParse(jsonObjectSchema, { a: 1 }).success).toBe(true);
    expect(v.safeParse(jsonObjectSchema, ['not', 'an', 'object']).success).toBe(false);
    expect(v.safeParse(jsonObjectSchema, 'string').success).toBe(false);

    expect(v.safeParse(siteDomainHostBodySchema, { host: 'scholar.example.com' }).success).toBe(true);
    expect(v.safeParse(siteDomainHostBodySchema, { host: '..' }).success).toBe(false);
    expect(v.safeParse(siteDomainHostBodySchema, { host: 'javascript:alert(1)' }).success).toBe(false);

    const qoe = v.safeParse(qoeBeaconSchema, {
      videoId: 'abc12345',
      watchMs: 5000,
      country: 'FORGED',
      __proto__: {},
    });
    expect(qoe.success).toBe(true);
    if (qoe.success) {
      expect((qoe.output as Record<string, unknown>).country).toBeUndefined();
    }

    expect(v.safeParse(errorReportEnvelopeSchema, { events: [{ msg: 'ok' }] }).success).toBe(true);
    expect(v.safeParse(errorReportEnvelopeSchema, { events: 'bad' }).success).toBe(false);

    expect(v.safeParse(videoAnalyticsBatchSchema, { events: [{ eventType: 'ready', videoId: 'v1' }] }).success).toBe(true);
    expect(v.safeParse(videoAnalyticsBatchSchema, { events: 'not-array' }).success).toBe(false);

    expect(
      v.safeParse(createModerationReportSchema, { contentType: 'video', contentId: '../admin', reason: 'spam' }).success,
    ).toBe(false);
    expect(
      v.safeParse(createModerationReportSchema, { contentType: 'video', contentId: 'vid-1', reason: 'spam' }).success,
    ).toBe(true);

    expect(
      v.safeParse(translateTextsSchema, { items: [{ id: '1', text: 'Hello' }], from: 'en', to: 'ar' }).success,
    ).toBe(true);
    expect(
      v.safeParse(translateTextsSchema, { items: [], from: 'en', to: 'ar' }).success,
    ).toBe(false);
  });
});
