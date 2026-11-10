/**
 * Keeps the public host across the skew-protection hop (worker.ts).
 *
 * OpenNext skew protection serves a request from an old page (it carries the
 * old build's deployment id) by fetching the old Worker version through its
 * preview URL, <version>-<worker>.<account>.workers.dev. The old build then
 * sees that workers.dev host: middleware redirects, the sign-in redirect_uri
 * and sign-out return URL (built from the `host` header) would all point
 * there. So the current version stamps the public host on every request, and
 * a version reached through its preview URL puts that host back before Next
 * sees the request. Only our own hosts are accepted, so a forged header can at
 * most name another of our sites.
 *
 * apps/web/src/lib/version-skew/skew-host.ts is the original: keep them in step.
 */
export const SKEW_HOST_HEADER = 'x-aun-public-host';

const OWN_HOST = /^(?:[a-z0-9-]+\.)*alummahnow\.net$/;

export function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith('.workers.dev');
}

/** The request Next should see. Returns the input when nothing changes. */
export function withPublicHost(request: Request): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  if (isPreviewHost(url.hostname)) {
    const host = headers.get(SKEW_HOST_HEADER)?.toLowerCase();
    if (!host || !OWN_HOST.test(host)) return request;
    headers.delete(SKEW_HOST_HEADER);
    headers.set('host', host);
    headers.set('x-forwarded-host', host);
    url.host = host;
    url.protocol = 'https:';
    return new Request(url, new Request(request, { headers }));
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return request;
  // Public request: stamp (overwrite, never trust the client's value) the host
  headers.set(SKEW_HOST_HEADER, url.host);
  return new Request(request, { headers });
}
