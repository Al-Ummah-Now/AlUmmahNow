// Prototype only: same-origin path to the QA API, which does not allow the demo origin.
import { NextRequest } from 'next/server';

const QA_API = process.env.API_URL ?? '';

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!/^https:\/\/[\w.-]+\.qa\.alummahnow\.net$/.test(QA_API.replace(/\/$/, ''))) {
    return new Response('The theme demo only talks to QA.', { status: 500 });
  }
  const { path } = await ctx.params;
  const headers = new Headers(req.headers);
  for (const h of ['host', 'origin', 'referer', 'cookie', 'content-length']) headers.delete(h);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const res = await fetch(`${QA_API.replace(/\/$/, '')}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
    method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual',
  });
  const out = new Headers(res.headers);
  out.delete('content-encoding'); out.delete('content-length');
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
