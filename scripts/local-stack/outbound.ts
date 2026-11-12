/**
 * Every outbound fetch a stack worker makes goes through here (Miniflare `outboundService`).
 *
 * - Local hosts (the stack itself): passed through.
 * - Third parties with a fake (fake-external.ts registers them: Bunny, the image host, Resend):
 *   answered by the fake.
 * - Anything else: refused with 502 and logged, so a test can never reach QA, production or a paid
 *   API (AI providers included) by accident.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type FakeHandler = (request: Request, url: URL) => Promise<Response> | Response;

/** Fakes by hostname; a key starting with '.' matches the domain and its subdomains. */
export const FAKES = new Map<string, FakeHandler>();

export const refused: string[] = [];

export function fakeFor(hostname: string): FakeHandler | undefined {
  const exact = FAKES.get(hostname);
  if (exact) return exact;
  for (const [key, handler] of FAKES) if (key.startsWith('.') && (hostname === key.slice(1) || hostname.endsWith(key))) return handler;
  return undefined;
}

export async function outboundHandler(request: Request): Promise<Response> {
  const target = new URL(request.url);
  if (LOCAL_HOSTS.has(target.hostname)) {
    // Node resolves "localhost" to ::1 first; the stack listens on 127.0.0.1
    if (target.hostname !== '127.0.0.1') target.hostname = '127.0.0.1';
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers: request.headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }
    return fetch(target, init);
  }
  const fake = fakeFor(target.hostname);
  if (fake) return fake(request, target);
  const line = `${request.method} ${target.origin}${target.pathname}`;
  refused.push(line);
  process.stderr.write(`[local-stack] refused outbound ${line} (no fake; the local stack never calls deployed or paid services)\n`);
  return new Response(`local stack: outbound request to ${target.hostname} refused`, { status: 502 });
}
