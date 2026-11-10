/**
 * Files of a published theme package (images and fonts its CSS names), served from this site's
 * origin so the page's CSP needs no extra source. Published versions never change, so the answer
 * is cached for a year.
 */
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FILE = /^assets\/(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(svg|png|jpg|jpeg|webp|ico|woff2)$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; path: string[] }> }) {
  const { id, version, path } = await params;
  const file = path.join('/');
  const adminApi = process.env.ADMIN_API_URL;
  if (!adminApi || !ID.test(id) || !VERSION.test(version) || !FILE.test(file)) return new Response('Not found', { status: 404 });
  const upstream = await fetch(`${adminApi}/public/themes/${id}/${version}/${file}`, { next: { revalidate: 86400 } }).catch(() => null);
  if (!upstream?.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=30' } });
  const headers = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (file.endsWith('.svg')) headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return new Response(upstream.body, { headers });
}
