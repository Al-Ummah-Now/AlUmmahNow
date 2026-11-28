import { readThemeUpload } from '@al-ummah/theme-packages';
import { logger } from '@/lib/logger';

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'content-security-policy', 'x-content-type-options'];

export async function proxyThemeRequest(request: Request, target: string, accessToken: string): Promise<Response> {
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const body = hasBody ? await readThemeUpload(request) : undefined;
    if (body === null) return Response.json({ success: false, error: 'The upload is larger than 16 MB' }, { status: 413 });
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(request.headers.get('content-type') ? { 'Content-Type': request.headers.get('content-type')! } : {}),
      },
      body,
      redirect: 'manual',
      cache: 'no-store',
    });
    // Workerd supports manual redirects. Keep upstream redirects away from the browser.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new Error('Unexpected redirect from Admin API');
    }
    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    logger.error('[themes proxy] Admin API unreachable', { method: request.method, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ success: false, error: 'Admin API unreachable' }, { status: 503 });
  }
}
