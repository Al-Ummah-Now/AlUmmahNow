/**
 * A request for a file (a chunk, a source map, an image). One that is missing renders the not-found page:
 * worker.ts marks the request so the layout does not read the site theme for it.
 */
export const STATIC_FILE_HEADER = 'x-aun-static-file';

const FILE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|txt|xml|json|php|yml|yaml|env)$/i;

export const isStaticFile = (pathname: string): boolean => pathname.startsWith('/_next/static/') || FILE.test(pathname);

/** The request with the mark set by us only: a client's own value is dropped. */
export function markStaticFile(request: Request): Request {
  const marked = isStaticFile(new URL(request.url).pathname);
  if (!marked && !request.headers.has(STATIC_FILE_HEADER)) return request;
  const headers = new Headers(request.headers);
  if (marked) headers.set(STATIC_FILE_HEADER, '1');
  else headers.delete(STATIC_FILE_HEADER);
  return new Request(request, { headers });
}
