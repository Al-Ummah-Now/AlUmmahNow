/**
 * Files of a published theme package (images, fonts and art its CSS names), served from this site's
 * origin so the page's CSP needs no extra source. Published versions never change, so the answer
 * is cached for a year.
 */
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FILE = /^assets\/(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(svg|png|jpg|jpeg|webp|ico|woff2)$/;
/** The theme's art per mode, with its colours written in (admin-api compileVersion): the sign-in banner's */
const ART = /^art\/(light|dark)\.svg$/;
const EXT_CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; version: string; path: string[] }> }) {
  const { id, version, path } = await params;
  const file = path.join('/');
  const adminApi = process.env.ADMIN_API_URL;
  if (!adminApi || !ID.test(id) || !VERSION.test(version) || !(FILE.test(file) || ART.test(file))) return new Response('Not found', { status: 404 });
  const upstream = await fetch(`${adminApi}/public/themes/${id}/${version}/${file}`, { next: { revalidate: 86400 } }).catch(() => null);
  if (!upstream?.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=30' } });
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  const contentType = EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (ext === 'svg') headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return new Response(upstream.body, { headers });
}
