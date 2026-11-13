/**
 * Studio → Site → Domains (#1212): which admin-api /internal/site-domains route a Studio call maps to
 * (app/api/studio/site-domains). Anything else is refused before it leaves this site.
 */
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;

/** The admin-api path for a Studio call (method, channel, path after it), or null when it is none of them. */
export function upstreamPath(method: string, channelId: string, path: string[]): string | null {
  if (!CHANNEL_ID.test(channelId)) return null;
  const base = `/internal/site-domains/${channelId}`;
  if (path.length === 0 && (method === 'GET' || method === 'POST')) return `${base}/domains`;
  if (path.length === 1 && path[0] === 'primary' && method === 'PUT') return `${base}/primary`;
  const host = (path[0] ?? '').toLowerCase();
  if (!HOST.test(host)) return null;
  if (path.length === 1 && method === 'DELETE') return `${base}/domains/${encodeURIComponent(host)}`;
  if (path.length === 2 && path[1] === 'refresh' && method === 'POST') return `${base}/domains/${encodeURIComponent(host)}/refresh`;
  return null;
}

