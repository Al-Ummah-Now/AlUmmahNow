/**
 * A worker's static assets binding (`assets.binding`, e.g. ASSETS) served from Node.
 *
 * Miniflare names every assets service per worker except the storage one: each worker with
 * `assets` adds a service called `assets:storage` pointing at its own directory, and workerd keeps
 * only one of them. With two OpenNext apps in one Miniflare (web and admin-web), the second app's
 * asset manifest then resolves against the first app's files and every lookup answers 500 with an
 * empty body (its pages render without CSS or JS). The stack's sockets go straight to each user
 * worker (unsafeDirectSockets), so the assets router is not used anyway: boot.ts drops the
 * `assets` option and binds this handler instead, one per worker, each on its own directory.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

/** The file under `directory` for a request path, or null (outside it, missing, a directory). */
export function assetFile(directory: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = normalize(directory);
  const file = normalize(join(root, decoded));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  for (const candidate of [file, join(file, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The binding's fetch: GET/HEAD of a file under `directory`; 404 otherwise (as the assets binding). */
export function assetsHandler(directory: string): (request: Request) => Response {
  return (request) => {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405 });
    const file = assetFile(directory, new URL(request.url).pathname);
    if (!file) return new Response(null, { status: 404 });
    const body = readFileSync(file);
    const headers = { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(body.length), 'cache-control': 'public, max-age=0, must-revalidate' };
    return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
  };
}
