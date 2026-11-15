/**
 * Share images leave with a Content-Length (2026-11-15). OpenNext streams every Next response
 * (Transfer-Encoding: chunked), so a route's own Content-Length header is dropped. Chat apps check
 * a preview image's size before using it large (WhatsApp: under 600 KB); YouTube's and www's
 * preview images are sent with a length, ours were not. The images are small (tens of KB), so
 * reading the body once here costs nothing. Shared by web and admin-web (worker.ts is identical in
 * both); admin-web serves no such paths, so it never changes anything there.
 */
const SHARE_IMAGE = /^\/(og\/[vci]|thumb)\/[^/]+\.jpg$/;

export async function withWholeBody(request: Request, response: Response): Promise<Response> {
  if (request.method !== 'GET' || response.status !== 200 || !response.body) return response;
  if (!SHARE_IMAGE.test(new URL(request.url).pathname)) return response;
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.delete('transfer-encoding');
  headers.set('content-length', String(body.byteLength));
  return new Response(body, { status: 200, statusText: response.statusText, headers });
}
