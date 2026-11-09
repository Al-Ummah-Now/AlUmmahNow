/**
 * Stand-ins for the Workers runtime pieces the socket object uses: sockets with
 * attachments, the object state that keeps accepted sockets across instances,
 * and a namespace that runs each named object's calls one at a time.
 */
export class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  sends = 0;
  closed?: { code?: number; reason?: string };
  private attachment: string | null = null;
  send(data: string) { this.sends++; this.sent.push(JSON.parse(data)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  // Attachments survive hibernation as structured clones (2 KiB max)
  serializeAttachment(value: unknown) {
    const json = JSON.stringify(value);
    if (json.length > 2048) throw new Error('attachment too large');
    this.attachment = json;
  }
  deserializeAttachment() { return this.attachment === null ? null : JSON.parse(this.attachment); }
  last() { return this.sent[this.sent.length - 1]; }
}

/** The runtime's view of one object: the sockets it accepted outlive any instance. */
export class FakeCtx {
  accepted: Array<{ ws: FakeSocket; tags: string[] }> = [];
  acceptWebSocket(ws: FakeSocket, tags: string[] = []) { this.accepted.push({ ws, tags }); }
  getWebSockets(tag?: string) {
    return this.accepted.filter((a) => !a.ws.closed && (!tag || a.tags.includes(tag))).map((a) => a.ws);
  }
  waitUntil(p: Promise<unknown>) { void p; }
}


const RealResponse = globalThis.Response;

/** Workers allow `new Response(null, { status: 101, webSocket })`; Node does not. */
export function installWorkerGlobals(): void {
  (globalThis as any).Response = class {
    status: number; webSocket: unknown; body: unknown; headers: Headers;
    constructor(body: unknown, init: { status?: number; webSocket?: unknown; headers?: HeadersInit } = {}) {
      this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket;
      this.headers = new Headers(init.headers);
    }
    get ok() { return this.status >= 200 && this.status < 300; }
    async json() { return JSON.parse(String(this.body)); }
    static json(data: unknown, init: { status?: number } = {}) {
      return new (globalThis as any).Response(JSON.stringify(data), init);
    }
  };
  (globalThis as any).WebSocketPair = class {
    0 = new FakeSocket(); 1 = new FakeSocket();
  };
}

export function restoreWorkerGlobals(): void {
  (globalThis as any).Response = RealResponse;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, Math.floor(Math.random() * 3)));

/**
 * Durable Object namespace: one instance per name, and like the platform's
 * input gate each object handles one request at a time (calls queue up).
 * `hibernate(name)` drops the instance; the next call constructs a new one
 * over the same accepted sockets.
 */
export class FakeNamespace<T extends { fetch(r: Request): Promise<Response> }> {
  objects = new Map<string, { ctx: FakeCtx; instance?: T; queue: Promise<unknown> }>();
  calls = new Map<string, number>();
  env: Record<string, unknown> = {};
  constructor(private readonly make: (ctx: FakeCtx, env: any) => T) {}
  idFromName(name: string) { return { name } as any; }
  get(id: { name: string }) {
    return {
      fetch: (request: Request) => this.call(id.name, (o) => o.fetch(request)),
    };
  }
  instance(name: string): T {
    let entry = this.objects.get(name);
    if (!entry) this.objects.set(name, (entry = { ctx: new FakeCtx(), queue: Promise.resolve() }));
    entry.instance ??= this.make(entry.ctx, this.env);
    return entry.instance;
  }
  call<R>(name: string, fn: (o: T) => Promise<R>): Promise<R> {
    this.instance(name);
    const entry = this.objects.get(name)!;
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
    const run = entry.queue.then(async () => { await tick(); return fn(this.instance(name)); });
    entry.queue = run.catch(() => undefined);
    return run;
  }
  hibernate(name: string) {
    const entry = this.objects.get(name);
    if (entry) entry.instance = undefined;
  }
}
