/**
 * Short-lived idle connections for the suite's own `fetch` calls (the admin API, the issuer, the
 * stack's control API).
 *
 * Node's fetch (undici) keeps an idle connection for 4 s; workerd closes one after about 4.7 s. A
 * test process that was starved for a few seconds (the WebKit job runs four browsers beside the
 * stack on four cores) sends its next request on a connection the server has already closed, and
 * the call fails with `fetch failed: SocketError: other side closed` although the server is fine
 * (#1941: OPS-02 at support/api.ts). With a 1 s keep-alive the connection is closed here before
 * the server's limit can come into play unless the process stands still for several seconds.
 *
 * undici's global dispatcher is replaced by a new one of the same class with the shorter limit
 * (the class is read from the current dispatcher: this suite has no direct undici dependency).
 */
const GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');
const KEEP_ALIVE_MS = 1000;

interface Dispatcher {
  constructor: new (options: { keepAliveTimeout: number; keepAliveMaxTimeout: number }) => Dispatcher;
  shortKeepAlive?: true;
}

export function shortKeepAlive(): boolean {
  // Node loads undici lazily; reading a global it provides loads it and installs the dispatcher
  void globalThis.Headers;
  const holder = globalThis as unknown as Record<symbol, Dispatcher | undefined>;
  const current = holder[GLOBAL_DISPATCHER];
  if (!current) return false;
  if (current.shortKeepAlive) return true;
  const next = new current.constructor({ keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: KEEP_ALIVE_MS });
  next.shortKeepAlive = true;
  holder[GLOBAL_DISPATCHER] = next;
  return true;
}

shortKeepAlive();
