/**
 * The browser's proxy for E2E runs on the local stack (Playwright `use.proxy`, with
 * `ignoreHTTPSErrors`), on PORTS['browser-proxy'].
 *
 * The apps put real third-party URLs in pages (https://vz-….b-cdn.net/<guid>/playlist.m3u8,
 * https://images.alummahnow.net/…). In every browser, without touching a spec:
 * - CONNECT to a faked host: TLS is terminated here with a throwaway self-signed certificate and
 *   the request is answered by the same fake the workers use (fake-external.ts);
 * - plain HTTP (and CONNECT) to localhost: passed through to the stack (browsers bypass the proxy
 *   for localhost anyway: `bypass: 'localhost,127.0.0.1'`);
 * - public static CDNs (PUBLIC_STATIC_HOSTS): tunnelled unchanged;
 * - anything else: refused (502), so a local run can never load QA, production or a third party.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';
import { join } from 'node:path';
import { fakeFor } from './outbound.ts';
import { PORTS, STATE_DIR } from './stack.ts';

const LOCAL = new Set(['localhost', '127.0.0.1']);
/**
 * Public, read-only static CDNs the pages load scripts, styles and fonts from (not QA, not
 * production, nothing paid): tunnelled to the real host unchanged.
 */
export const PUBLIC_STATIC_HOSTS = new Set([
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);
/** Only the stack's own ports are reachable through the proxy. */
const STACK_PORTS = new Set<number>(Object.values(PORTS));

/** The fake for a host, only when it is a registered handler. */
function fakeHandler(host: string) {
  const handler = fakeFor(host);
  return typeof handler === 'function' ? handler : undefined;
}

export const refusedByProxy: string[] = [];

/** One line per proxied request (method, URL, status, ms) on stderr, the stack log: what the browser actually got. */
function trace(method: string | undefined, target: string, status: number | string, started: number): void {
  process.stderr.write(`[local-stack] proxy ${method ?? '?'} ${target.replace(/\?.*$/, '')} -> ${status} ${Date.now() - started}ms\n`);
}

/** A self-signed certificate for the faked hosts (browsers run with ignoreHTTPSErrors). */
function certificate(): { key: Buffer; cert: Buffer } {
  const dir = join(STATE_DIR, 'tls');
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (!existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=local-stack', '-keyout', key, '-out', cert, '-days', '7'], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

async function toFetchRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
  return new Request(new URL(req.url ?? '/', origin), { method: req.method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function refuse(target: string): void {
  refusedByProxy.push(target);
  process.stderr.write(`[local-stack] browser request to ${target} refused (not local, no fake)\n`);
}

/** Pipes a CONNECT tunnel both ways; an error on either side closes both. */
function tunnel(client: Duplex, upstream: Socket, head: Buffer): void {
  upstream.on('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.on('error', close);
  client.on('error', close);
}

export function startBrowserProxy(): Promise<() => Promise<void>> {
  const tls = certificate();

  // Requests on a terminated TLS connection: the Host header names the faked host
  const fakeServer = createServer(async (req, res) => {
    res.on('error', () => undefined);
    const host = (req.headers.host ?? '').split(':')[0];
    const fake = fakeHandler(host);
    if (!fake) {
      refuse(`https://${host}${req.url}`);
      res.writeHead(502).end();
      return;
    }
    const started = Date.now();
    const request = await toFetchRequest(req, `https://${host}`);
    const response = await fake(request, new URL(request.url));
    trace(req.method, `https://${host}${req.url}`, response.status, started);
    await send(res, response);
  });

  const proxy = createServer(async (req, res) => {
    // Plain-HTTP proxy request: absolute URL
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const started = Date.now();
    if (LOCAL.has(target.hostname)) {
      const port = Number(target.port || 80);
      if (!STACK_PORTS.has(port)) {
        refuse(target.href);
        res.writeHead(502).end();
        return;
      }
      // Streamed to the stack on loopback, on one of its own ports: headers as sent (Host kept, so
      // Next's Server Action origin check holds), the body and the response streamed both ways
      // (streamed HTML, server-sent events). Only the path comes from the request.
      const upstream = httpRequest(
        { host: '127.0.0.1', port, method: req.method, path: `${target.pathname}${target.search}`, headers: req.headers },
        (answer) => {
          trace(req.method, target.href, answer.statusCode ?? 502, started);
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on('error', (error) => {
        trace(req.method, target.href, `error ${error.message}`, started);
        if (res.headersSent) res.destroy();
        else res.writeHead(502).end();
      });
      req.pipe(upstream);
      return;
    }
    const fake = fakeHandler(target.hostname);
    if (fake) {
      const request = await toFetchRequest(req, target.origin);
      await send(res, await fake(request, target));
      return;
    }
    refuse(target.href);
    res.writeHead(502).end();
  });

  // A browser closing a connection mid-transfer (EPIPE, ECONNRESET) must never take the stack down
  proxy.on('connect', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    process.stderr.write(`[local-stack] proxy CONNECT ${req.url}\n`);
    const [host, port = '443'] = (req.url ?? '').split(':');
    if (LOCAL.has(host)) {
      if (!STACK_PORTS.has(Number(port))) {
        refuse(`https://${host}:${port}`);
        socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        return;
      }
      tunnel(socket, connect(Number(port), '127.0.0.1'), head);
      return;
    }
    if (PUBLIC_STATIC_HOSTS.has(host) && port === '443') {
      tunnel(socket, connect(443, host), head);
      return;
    }
    if (!fakeHandler(host)) {
      refuse(`https://${host}`);
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const secure = new TLSSocket(socket, { isServer: true, key: tls.key, cert: tls.cert, ALPNProtocols: ['http/1.1'] });
    secure.on('error', () => secure.destroy());
    if (head.length) socket.unshift(head);
    fakeServer.emit('connection', secure);
  });
  // WebSocket upgrades through the proxy (browsers that proxy localhost): piped to the stack port
  proxy.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      socket.destroy();
      return;
    }
    const port = Number(target.port || 80);
    if (!LOCAL.has(target.hostname) || !STACK_PORTS.has(port)) {
      refuse(target.href);
      socket.destroy();
      return;
    }
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
  });
  proxy.on('clientError', (_e, socket) => socket.destroy());

  return new Promise((resolve) => {
    proxy.listen(PORTS['browser-proxy'], '127.0.0.1', () =>
      resolve(() => new Promise((done) => proxy.close(() => fakeServer.close(() => done())))),
    );
  });
}
