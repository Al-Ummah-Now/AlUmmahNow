/**
 * WebSocket Durable Object
 * Handles WebSocket connections, authentication, and message routing.
 *
 * Hibernation-safe: everything a socket needs (session, user, token expiry,
 * channels, rate-limit window) lives in its attachment
 * (`ws.serializeAttachment`). The in-memory indexes below are only a cache,
 * rebuilt from `ctx.getWebSockets()` whenever the runtime constructs the
 * object again (after hibernation, eviction or a code update).
 *
 * Socket objects are sharded (`sockets:<n>`, see shards.ts). The same class
 * hosts the per-channel directories of the topic router (`topic:<channel>`,
 * see shards.ts) and the view counter (`views:<videoId>:<shard>`, see
 * view-counter.ts).
 */

import { DurableObject } from "cloudflare:workers";
import { authenticateToken, canPublish, canSubscribe, canSubscribeAnonymously } from './auth';
import { ClientMessageSchema, ServerMessage } from './messages';
import { logger } from './lib/logger';
import { ViewCounter, type CounterStorage, type VideoBucket } from './view-counter';
import { PostViewCounter, type CounterDb, type PostCounterStorage } from './post-view-counter';
import { SHARD_HEADER, isSocketShardName, routeBroadcast, shardRequest, topicName, type BroadcastItem, type FanOutResult } from './shards';

/** Tag on every accepted socket, so its state can be found again after hibernation. */
const SOCKET_TAG = 'socket';
/** An attachment may hold at most 2 KiB; channels are capped to stay well below. */
export const MAX_ATTACHMENT_BYTES = 2048;
export const MAX_CHANNELS_PER_SOCKET = 12;
/** Most broadcast items one internal request may carry. */
export const MAX_BROADCAST_ITEMS = 1000;
/** Shard storage: set once every local channel is in its directory (see shards.ts topicRoutingReady). */
const TOPICS_JOINED_KEY = 'topics-joined';
/** Directory storage: one key per shard holding the channel, valued with the join's generation. */
const TOPIC_SHARD_PREFIX = 's:';
const JOIN_RETRY_DELAYS_MS = [50, 250, 1000];

/** Per-socket state, stored in the socket's attachment. */
export interface SocketState {
  sessionId: string;
  userId?: string;
  authenticated: boolean;
  /** Unix seconds when the token the socket authenticated with expires (#437). */
  authExpiresAt?: number;
  connectedAt: number;
  /** Client IP, the rate-limit key until the socket signs in. */
  ip?: string;
  /** Name of the shard holding the socket (`sockets:<n>`), for directory joins. */
  shard?: string;
  channels: string[];
  /** Fixed-window message counter: survives hibernation with the attachment. */
  rl: { count: number; resetAt: number };
}

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type SocketEnv = Env & { WS_MESSAGE_LIMITER?: RateLimiter };

export class WebSocketDurableObject extends DurableObject {
  /** Cache of each socket's attachment. */
  private sockets: Map<WebSocket, SocketState> = new Map();
  /** channel -> sockets subscribed to it. */
  private subscribers: Map<string, Set<WebSocket>> = new Map();
  private viewCounter?: ViewCounter;
  private postViewCounter?: PostViewCounter;
  /** Directory joins in flight, shared by sockets subscribing to the same channel meanwhile. */
  private joining: Map<string, Promise<boolean>> = new Map();
  /** Bumped on every failed join, so a readiness probe running meanwhile does not vouch for it. */
  private joinFailures = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.rebuildIndex();
  }

  /** Rebuilds the in-memory indexes from the sockets the runtime kept open. */
  private rebuildIndex(): void {
    this.sockets.clear();
    this.subscribers.clear();
    const live = typeof this.ctx.getWebSockets === 'function' ? this.ctx.getWebSockets(SOCKET_TAG) : [];
    for (const ws of live) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (!state?.sessionId) continue;
      this.sockets.set(ws, state);
      for (const channel of state.channels) this.index(ws, channel);
    }
  }

  private index(ws: WebSocket, channel: string): void {
    let set = this.subscribers.get(channel);
    if (!set) this.subscribers.set(channel, (set = new Set()));
    set.add(ws);
  }

  private unindex(ws: WebSocket, channel: string): void {
    const set = this.subscribers.get(channel);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.subscribers.delete(channel);
  }

  /** Writes a socket's state back to its attachment. */
  private save(ws: WebSocket, state: SocketState): void {
    try {
      ws.serializeAttachment(state);
    } catch (error) {
      logger.error('Failed to save socket state', error);
    }
  }

  /** Number of sockets subscribed to a channel on this shard. */
  subscriberCount(channel: string): number {
    return this.subscribers.get(channel)?.size ?? 0;
  }

  /**
   * Handle HTTP upgrade to WebSocket and internal endpoints
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // View counter role (objects named views:<videoId>:<shard>, see view-counter.ts).
    // It lives in this class only because a new Durable Object class needs a
    // migration, which the release's `wrangler versions upload` cannot apply.
    // Reachable only through the DO binding: index.ts never forwards this path.
    if (url.pathname === '/views/increment' && request.method === 'POST') {
      return await this.handleViewIncrement(request);
    }
    // Post view counter role (objects named postviews:<postId>:<shard>, see post-view-counter.ts)
    if (url.pathname === '/post-views/increment' && request.method === 'POST') {
      return await this.handlePostViewIncrement(request);
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return await this.handleBroadcastRequest(request);
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      return this.handleStatsRequest();
    }

    if (url.pathname === '/topic/join' && request.method === 'POST') {
      return await this.handleTopicJoin(request);
    }

    if (url.pathname === '/topic/route' && request.method === 'POST') {
      return await this.handleTopicRoute(request);
    }

    if (url.pathname === '/topic/ready' && request.method === 'GET') {
      return await this.handleTopicReady(request);
    }

    if (url.pathname === '/presence' && request.method === 'GET') {
      return Response.json({ sessions: this.userSessionCount(url.searchParams.get('userId') ?? '') });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const env = this.env as SocketEnv;
    const maxConnections = Number(env.MAX_CONNECTIONS_PER_DO) || 1000;
    if (this.ctx.getWebSockets(SOCKET_TAG).length >= maxConnections) {
      return new Response('Connection limit reached', { status: 503 });
    }

    // Only `token` is read. A `userId` query param is deliberately ignored: the
    // connection's identity comes solely from a verified token.
    const token = url.searchParams.get('token');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [SOCKET_TAG]);

    const state: SocketState = {
      sessionId: crypto.randomUUID(),
      authenticated: false,
      connectedAt: Date.now(),
      ip: request.headers.get('CF-Connecting-IP') ?? undefined,
      shard: shardNameOf(request),
      channels: [],
      rl: { count: 0, resetAt: 0 },
    };
    this.sockets.set(server, state);
    this.save(server, state);

    this.sendMessage(server, { type: 'connection_acknowledged', sessionId: state.sessionId });

    // DEPRECATION: Token in URL is a security risk (exposed in logs, browser history)
    // Clients should send token via 'authenticate' message after connection
    if (token) {
      logger.warn('DEPRECATED: Token received in URL. Client should use authenticate message instead.', {
        sessionId: state.sessionId,
      });
      await this.handleAuthentication(server, token);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const state = this.sockets.get(ws);
      if (!state) {
        // Not one of ours (no attachment): tell the client to reconnect rather than go silent
        ws.close(1011, 'Unknown session; reconnect');
        return;
      }

      if (!(await this.checkRateLimit(ws, state))) {
        this.sendMessage(ws, { type: 'error', error: 'Rate limit exceeded', code: 'RATE_LIMIT' });
        return;
      }

      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      if (data.length > 100000) {
        this.sendMessage(ws, { type: 'error', error: 'Message too large', code: 'PAYLOAD_TOO_LARGE' });
        return;
      }

      const validationResult = ClientMessageSchema.safeParse(JSON.parse(data));
      if (!validationResult.success) {
        this.sendMessage(ws, { type: 'error', error: 'Invalid message format', code: 'INVALID_MESSAGE' });
        return;
      }
      const clientMessage = validationResult.data;

      // A socket stays signed in only as long as its token (#437). Before a
      // re-auth too, so a failed one leaves the socket signed out.
      this.expireAuthIfNeeded(ws, { notify: clientMessage.type !== 'authenticate' });

      switch (clientMessage.type) {
        case 'authenticate':
          await this.handleAuthentication(ws, clientMessage.token);
          break;
        case 'subscribe':
          await this.handleSubscribe(ws, clientMessage.channel);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, clientMessage.channel);
          break;
        case 'message':
          this.handleMessage(ws, clientMessage.channel, clientMessage.data);
          break;
        case 'ping':
        case 'heartbeat':
          this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
          break;
        default:
          this.sendMessage(ws, { type: 'error', error: 'Unknown message type', code: 'UNKNOWN_MESSAGE_TYPE' });
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      this.sendMessage(ws, { type: 'error', error: 'Failed to process message', code: 'PROCESSING_ERROR' });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    const state = this.forget(ws);
    // Complete the close handshake (no auto-reply at this compatibility date)
    try {
      ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, reason);
    } catch {
      // already closed
    }
    if (state) logger.debug(`WebSocket closed: ${state.sessionId}, code: ${code}, reason: ${reason}`);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.error('WebSocket error:', error);
    this.forget(ws);
  }

  /** The one cleanup path for a closed or failed socket: drops it from every index. */
  private forget(ws: WebSocket): SocketState | undefined {
    const state = this.sockets.get(ws);
    if (!state) return undefined;
    for (const channel of state.channels) this.unindex(ws, channel);
    this.sockets.delete(ws);
    return state;
  }

  /**
   * Once the token a socket authenticated with has expired, the socket drops
   * its private channels and is told to authenticate again (the client sends a
   * fresh token on AUTH_EXPIRED). Signing out everywhere therefore reaches open
   * sockets within one access-token lifetime: the fresh token is checked
   * against the revocation list.
   */
  private expireAuthIfNeeded(
    ws: WebSocket,
    { notify = true, nowSeconds = Math.floor(Date.now() / 1000) }: { notify?: boolean; nowSeconds?: number } = {},
  ): boolean {
    const state = this.sockets.get(ws);
    if (!state?.authenticated || state.authExpiresAt === undefined || nowSeconds < state.authExpiresAt) {
      return false;
    }
    for (const channel of state.channels) {
      if (!canSubscribeAnonymously(channel)) this.unindex(ws, channel);
    }
    state.channels = state.channels.filter(canSubscribeAnonymously);
    state.authenticated = false;
    this.save(ws, state);
    if (notify) {
      this.sendMessage(ws, { type: 'error', error: 'Token expired; authenticate again', code: 'AUTH_EXPIRED' });
    }
    return true;
  }

  /** A private channel's message must not reach a socket whose token has expired, even a silent one. */
  private expiredForChannel(ws: WebSocket, channel: string): boolean {
    return !canSubscribeAnonymously(channel) && this.expireAuthIfNeeded(ws);
  }

  private async handleAuthentication(ws: WebSocket, token: string): Promise<void> {
    const state = this.sockets.get(ws);
    if (!state) return;

    try {
      // Signature, issuer, expiry and client are checked in authenticateToken;
      // unsigned tokens are only accepted when ENVIRONMENT=development.
      const authPayload = await authenticateToken(token, this.env as Env);
      if (!authPayload) {
        this.sendMessage(ws, { type: 'error', error: 'Invalid or expired token', code: 'AUTH_FAILED' });
        return;
      }

      // A connection cannot switch to a different user; re-auth is only a token refresh.
      if (state.userId !== undefined && state.userId !== authPayload.sub) {
        this.sendMessage(ws, { type: 'error', error: 'Connection is already authenticated as another user', code: 'AUTH_FAILED' });
        return;
      }

      state.authenticated = true;
      state.userId = authPayload.sub;
      state.authExpiresAt = authPayload.exp;
      // Auto-subscribe to the user's notification channel
      const userChannel = `user:${authPayload.sub}`;
      const join = this.needsJoin(userChannel);
      this.addChannel(ws, state, userChannel);
      this.save(ws, state);
      if (join) await this.joinTopic(userChannel, state.shard);

      this.sendMessage(ws, { type: 'authenticated', userId: authPayload.sub, sessionId: state.sessionId });
    } catch (error) {
      logger.error('Authentication error:', error);
      this.sendMessage(ws, { type: 'error', error: 'Authentication failed', code: 'AUTH_ERROR' });
    }
  }

  /** Adds a channel to a socket if it fits in the attachment. Caller saves. */
  private addChannel(ws: WebSocket, state: SocketState, channel: string): boolean {
    if (state.channels.includes(channel)) return true;
    const next = [...state.channels, channel];
    if (next.length > MAX_CHANNELS_PER_SOCKET || JSON.stringify({ ...state, channels: next }).length > MAX_ATTACHMENT_BYTES) {
      return false;
    }
    state.channels = next;
    this.index(ws, channel);
    return true;
  }

  private async handleSubscribe(ws: WebSocket, channel: string): Promise<void> {
    const state = this.sockets.get(ws);
    if (!state) return;

    // Signed-out viewers may follow public video feeds; everything else needs a token.
    if (!state.authenticated && !canSubscribeAnonymously(channel)) {
      this.sendMessage(ws, { type: 'error', error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    // user:<id> channels carry private notifications; only that user may join.
    if (state.authenticated && (!state.userId || !canSubscribe(state.userId, channel))) {
      this.sendMessage(ws, { type: 'error', error: 'Not allowed to subscribe to this channel', code: 'FORBIDDEN' });
      return;
    }

    const join = this.needsJoin(channel);
    if (!this.addChannel(ws, state, channel)) {
      this.sendMessage(ws, { type: 'error', error: 'Too many channels on this connection', code: 'SUBSCRIBE_FAILED' });
      return;
    }
    this.save(ws, state);
    // Confirmed only once the channel's directory routes its broadcasts here
    if (join) await this.joinTopic(channel, state.shard);
    this.sendMessage(ws, { type: 'subscribed', channel });
  }

  private handleUnsubscribe(ws: WebSocket, channel: string): void {
    const state = this.sockets.get(ws);
    if (!state) return;
    state.channels = state.channels.filter((c) => c !== channel);
    this.unindex(ws, channel);
    this.save(ws, state);
    this.sendMessage(ws, { type: 'unsubscribed', channel });
  }

  /**
   * A client message reaches the subscribers on this shard and, through the
   * other shards, everyone else subscribed to the channel.
   */
  private handleMessage(ws: WebSocket, channel: string, data: unknown): void {
    const state = this.sockets.get(ws);
    if (!state || !state.authenticated) {
      this.sendMessage(ws, { type: 'error', error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }

    // Clients may not post into user:<id> channels; those are fed by /broadcast only.
    if (!canPublish(channel)) {
      this.sendMessage(ws, { type: 'error', error: 'Not allowed to publish to this channel', code: 'FORBIDDEN' });
      return;
    }

    const message: ServerMessage = { type: 'message', channel, data, from: state.userId, timestamp: Date.now() };
    const env = this.env as SocketEnv;
    if (env.WEBSOCKET_DO) {
      // Every shard holding the channel (this one included) delivers to its own subscribers
      this.ctx.waitUntil(
        routeBroadcast(env.WEBSOCKET_DO, env, [{ channel, message }]).catch((error) =>
          logger.error('Client message fan-out failed', error),
        ),
      );
    } else {
      this.deliver(channel, message);
    }
  }

  /**
   * Fixed-window limit per socket, kept in the attachment so hibernation does
   * not reset it, plus (when bound) a Workers Rate Limiting check per user or
   * IP, so opening more sockets does not buy more messages.
   */
  private async checkRateLimit(ws: WebSocket, state: SocketState): Promise<boolean> {
    const env = this.env as SocketEnv;
    const now = Date.now();
    const maxMessages = Number(env.RATE_LIMIT_MESSAGES) || 100;
    const windowMs = Number(env.RATE_LIMIT_WINDOW_MS) || 60000;

    if (now > state.rl.resetAt) {
      state.rl = { count: 0, resetAt: now + windowMs };
    }
    if (state.rl.count >= maxMessages) return false;
    state.rl.count++;
    this.save(ws, state);

    const limiter = env.WS_MESSAGE_LIMITER;
    const key = state.userId ? `u:${state.userId}` : state.ip ? `ip:${state.ip}` : undefined;
    if (limiter && key) {
      try {
        const { success } = await limiter.limit({ key });
        return success;
      } catch (error) {
        logger.warn('Rate limiter unavailable; per-socket limit only', error);
      }
    }
    return true;
  }

  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(message));
  }

  private sendRaw(ws: WebSocket, payload: string): boolean {
    try {
      ws.send(payload);
      return true;
    } catch (error) {
      logger.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  /** Sends a message to this shard's subscribers of a channel. Serialised once. Returns sockets reached. */
  deliver(channel: string, message: unknown): number {
    const subscribers = this.subscribers.get(channel);
    if (!subscribers || subscribers.size === 0) return 0;
    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const ws of [...subscribers]) {
      if (this.expiredForChannel(ws, channel)) continue;
      if (this.sendRaw(ws, payload)) delivered++;
    }
    return delivered;
  }

  /** Kept for callers of the old API. */
  async broadcast(channel: string, message: ServerMessage): Promise<void> {
    this.deliver(channel, message);
  }

  private userSessionCount(userId: string): number {
    if (!userId) return 0;
    let n = 0;
    for (const state of this.sockets.values()) {
      if (state.authenticated && state.userId === userId) n++;
    }
    return n;
  }

  /** Only view-counter objects (video or post) ever set an alarm. */
  async alarm(): Promise<void> {
    const posts = this.getPostViewCounter();
    if (await posts.active()) {
      await posts.alarm();
      return;
    }
    await this.getViewCounter().alarm();
  }

  private getPostViewCounter(): PostViewCounter {
    if (!this.postViewCounter) {
      const env = this.env as Env;
      this.postViewCounter = new PostViewCounter(
        this.ctx.storage as unknown as PostCounterStorage,
        env.NOTIFICATIONS_DB as unknown as CounterDb | undefined,
        { logger },
      );
    }
    return this.postViewCounter;
  }

  private async handlePostViewIncrement(request: Request): Promise<Response> {
    let body: { postId?: unknown; shard?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const postId = typeof body.postId === 'string' ? body.postId : '';
    const shard = typeof body.shard === 'number' || typeof body.shard === 'string' ? String(body.shard) : '';
    if (!postId || postId.length > 200 || !/^\d{1,3}$/.test(shard)) {
      return Response.json({ error: 'postId and shard are required' }, { status: 400 });
    }
    try {
      return Response.json(await this.getPostViewCounter().increment(postId, shard));
    } catch (error) {
      logger.error('Post view counter increment failed', { postId, shard, error: String(error) });
      return Response.json({ error: 'View not counted' }, { status: 500 });
    }
  }

  private getViewCounter(): ViewCounter {
    if (!this.viewCounter) {
      const env = this.env as Env;
      this.viewCounter = new ViewCounter(
        this.ctx.storage as unknown as CounterStorage,
        env.VIDEOS as unknown as VideoBucket | undefined,
        { logger, onFlushed: (videoId, views) => this.pushViewCount(videoId, views) },
      );
    }
    return this.viewCounter;
  }

  private async handleViewIncrement(request: Request): Promise<Response> {
    let body: { videoId?: unknown; shard?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const videoId = typeof body.videoId === 'string' ? body.videoId : '';
    const shard = typeof body.shard === 'number' || typeof body.shard === 'string' ? String(body.shard) : '';
    if (!videoId || videoId.length > 200 || !/^\d{1,3}$/.test(shard)) {
      return Response.json({ error: 'videoId and shard are required' }, { status: 400 });
    }
    try {
      return Response.json(await this.getViewCounter().increment(videoId, shard));
    } catch (error) {
      logger.error('View counter increment failed', { videoId, shard, error: String(error) });
      return Response.json({ error: 'View not counted' }, { status: 500 });
    }
  }

  /** Pushes a flushed count to everyone watching the video, on every socket shard. */
  private async pushViewCount(videoId: string, viewCount: number): Promise<void> {
    const env = this.env as Env;
    const channel = `video:${videoId}`;
    const message = { type: 'view_count_updated', channel, timestamp: Date.now(), data: { type: 'view_count_updated', videoId, viewCount } };
    const result = await routeBroadcast(env.WEBSOCKET_DO, env, [{ channel, message }]);
    if (result.failed > 0) throw new Error(`view count push failed on ${result.failed} of ${result.shards} shards`);
  }

  /** Body: `{ channel, message }` or `{ items: [{ channel, message }, ...] }`. */
  private async handleBroadcastRequest(request: Request): Promise<Response> {
    let items: BroadcastItem[];
    try {
      const body = (await request.json()) as { channel?: string; message?: unknown; items?: BroadcastItem[] };
      items = Array.isArray(body.items) ? body.items : [{ channel: body.channel as string, message: body.message }];
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (items.length === 0 || items.length > MAX_BROADCAST_ITEMS || items.some((i) => !i || typeof i.channel !== 'string' || !i.channel || !i.message)) {
      return Response.json({ error: 'Missing channel or message' }, { status: 400 });
    }
    let delivered = 0;
    for (const item of items) delivered += this.deliver(item.channel, item.message);
    // Which of these channels still have a subscriber here (a directory drops this shard otherwise)
    const held = [...new Set(items.map((i) => i.channel))].filter((c) => this.subscriberCount(c) > 0);
    return Response.json({ success: true, delivered, held });
  }

  // ---- Topic router: shard side ----

  /** A channel needs a directory join when this shard has no subscriber of it yet (or a join is in flight). */
  private needsJoin(channel: string): boolean {
    return this.subscriberCount(channel) === 0 || this.joining.has(channel);
  }

  /**
   * Adds this shard to the channel's directory. Sockets subscribing while a
   * join is in flight wait for the same one. The subscription stands even if
   * the join fails: the shard then stops vouching for the directories, so
   * broadcasts reach every shard until the next readiness probe has joined
   * all its channels again.
   */
  private async joinTopic(channel: string, shard: string | undefined): Promise<void> {
    const env = this.env as SocketEnv;
    if (!env.WEBSOCKET_DO) return; // no router (a lone object)
    let join = this.joining.get(channel);
    if (!join) {
      join = shard ? this.postJoin(channel, shard) : Promise.resolve(false);
      this.joining.set(channel, join);
      void join.finally(() => {
        if (this.joining.get(channel) === join) this.joining.delete(channel);
      });
    }
    if (await join) return;
    this.joinFailures++;
    try {
      await this.ctx.storage.delete(TOPICS_JOINED_KEY);
    } catch (error) {
      logger.error('Failed to clear the topics-joined flag', error);
    }
  }

  /**
   * One join, retried with backoff: a directory that stays down also fails
   * the broadcasts routed to it, and those fall back to every shard.
   */
  private async postJoin(channel: string, shard: string): Promise<boolean> {
    const env = this.env as SocketEnv;
    for (let attempt = 0; attempt < JOIN_RETRY_DELAYS_MS.length + 1; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, JOIN_RETRY_DELAYS_MS[attempt - 1]));
      try {
        const res = await env.WEBSOCKET_DO.get(env.WEBSOCKET_DO.idFromName(topicName(channel))).fetch(
          new Request('http://internal/topic/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shard }),
          }),
        );
        if (res.ok) return true;
        logger.warn('Topic join refused', { channel, shard, status: res.status, attempt });
      } catch (error) {
        logger.warn('Topic join failed', { channel, shard, error: String(error), attempt });
      }
    }
    logger.error('Topic join gave up; broadcasts go to every shard until the shard joins again', { channel, shard });
    return false;
  }

  /**
   * Readiness probe (shards.ts topicRoutingReady). The first time, and after
   * any failed join, joins every local channel's directory before vouching.
   */
  private async handleTopicReady(request: Request): Promise<Response> {
    const shard = shardNameOf(request);
    if (!shard) return Response.json({ error: 'Unknown shard' }, { status: 400 });
    if (await this.ctx.storage.get(TOPICS_JOINED_KEY)) return Response.json({ ready: true });
    const failuresBefore = this.joinFailures;
    const joined = await Promise.all([...this.subscribers.keys()].map((channel) => this.postJoin(channel, shard)));
    const ready = joined.every(Boolean) && this.joinFailures === failuresBefore;
    if (ready) await this.ctx.storage.put(TOPICS_JOINED_KEY, true);
    return Response.json({ ready });
  }

  // ---- Topic router: directory side (objects named topic:<channel>) ----

  private async handleTopicJoin(request: Request): Promise<Response> {
    let shard: unknown;
    try {
      ({ shard } = (await request.json()) as { shard?: unknown });
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (typeof shard !== 'string' || !isSocketShardName(shard)) {
      return Response.json({ error: 'Invalid shard' }, { status: 400 });
    }
    // A fresh generation, so a concurrent route that saw the shard empty does not drop this join
    await this.ctx.storage.put(TOPIC_SHARD_PREFIX + shard, crypto.randomUUID());
    return Response.json({ success: true });
  }

  /** Forwards a channel's broadcast items to the shards holding it. Serialised once for all of them. */
  private async handleTopicRoute(request: Request): Promise<Response> {
    let channel: unknown;
    let items: BroadcastItem[];
    try {
      const body = (await request.json()) as { channel?: unknown; items?: BroadcastItem[] };
      channel = body.channel;
      items = Array.isArray(body.items) ? body.items : [];
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (typeof channel !== 'string' || !channel || items.length === 0 || items.length > MAX_BROADCAST_ITEMS
      || items.some((i) => !i || i.channel !== channel || !i.message)) {
      return Response.json({ error: 'Missing channel or message' }, { status: 400 });
    }
    const env = this.env as SocketEnv;
    const holders = await this.ctx.storage.list<string>({ prefix: TOPIC_SHARD_PREFIX });
    const body = JSON.stringify({ items });
    const results = await Promise.allSettled(
      [...holders].map(async ([key, generation]) => {
        const shard = key.slice(TOPIC_SHARD_PREFIX.length);
        const res = await env.WEBSOCKET_DO.get(env.WEBSOCKET_DO.idFromName(shard)).fetch(
          shardRequest(shard, '/broadcast', { method: 'POST', body }),
        );
        if (!res.ok) throw new Error(`shard ${shard}: ${res.status}`);
        const json = (await res.json()) as { delivered?: number; held?: string[] };
        if (Array.isArray(json.held) && !json.held.includes(channel as string)) {
          // The shard no longer holds the channel; drop it unless it joined again meanwhile
          if ((await this.ctx.storage.get<string>(key)) === generation) await this.ctx.storage.delete(key);
        }
        return json.delivered ?? 0;
      }),
    );
    const out: FanOutResult = { shards: holders.size, failed: 0, delivered: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') out.delivered += r.value;
      else {
        out.failed++;
        logger.error('Topic fan-out to a shard failed', { channel, error: String(r.reason) });
      }
    }
    return Response.json(out);
  }

  private handleStatsRequest(): Response {
    const channelDetails: Record<string, number> = {};
    for (const [channel, set] of this.subscribers) channelDetails[channel] = set.size;
    let sessions = 0;
    for (const state of this.sockets.values()) if (state.authenticated) sessions++;
    return Response.json({
      connections: this.sockets.size,
      channels: this.subscribers.size,
      sessions,
      channelDetails,
    });
  }
}

/** The shard name the Worker put on an internal or upgrade request. */
function shardNameOf(request: Request): string | undefined {
  const name = request.headers.get(SHARD_HEADER);
  return name && isSocketShardName(name) ? name : undefined;
}
