/**
 * One realtime socket per tab for the videos admin's live updates
 * (docs/admin/LIVE_OPS.md §B.5). Every useAdminLive hook shares it.
 *
 * - Gets `{ url, token, expiresAt }` from the same-origin /api/realtime/token,
 *   authenticates, then subscribes to the `admin:<topic>` channels in use, one
 *   at a time (the server's FORBIDDEN reply does not name the channel).
 * - Reconnects with exponential backoff (1 s → 30 s, jittered) and
 *   re-authenticates on AUTH_EXPIRED and shortly before the token expires.
 * - Closes when no hook needs it (after a short grace) or once the tab has
 *   been hidden for 5 minutes; reopens when needed or visible again.
 *
 * A topic is "live" from the server's `subscribed` until the socket drops or
 * the channel is lost; hooks poll while it is not.
 */
import {
  ADMIN_LIVE_UPDATE,
  adminLiveChannel,
  adminLiveTopicOf,
  type AdminLiveTopic,
  type AdminLiveUpdate,
} from '@al-ummah/shared-types';

export interface RealtimeTicket {
  url: string;
  token: string;
  /** Unix seconds */
  expiresAt?: number;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ClientDeps {
  createSocket(url: string): SocketLike;
  fetchTicket(): Promise<RealtimeTicket | null>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
  random(): number;
  log?(level: 'debug' | 'warn', message: string, context?: Record<string, unknown>): void;
}

export type UpdateListener = (update: AdminLiveUpdate) => void;
export type LiveListener = (live: boolean) => void;

const OPEN = 1;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
export const HEARTBEAT_MS = 45_000;
export const IDLE_CLOSE_MS = 10_000;
export const HIDDEN_CLOSE_MS = 5 * 60_000;
/** Re-authenticate this long before the token expires. */
export const REAUTH_LEAD_MS = 60_000;

/** Delay before reconnect attempt `n` (0-based): doubling from 1 s, capped at 30 s, 50–100% jitter. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.5 + random() * 0.5));
}

/** The socket URL of a realtime base URL (https → wss, path /ws). */
export function socketUrlOf(base: string): string {
  const url = base.replace(/^http(s?):/, 'ws$1:').replace(/\/+$/, '');
  return url.endsWith('/ws') ? url : `${url}/ws`;
}

interface TopicState {
  updates: Set<UpdateListener>;
  live: Set<LiveListener>;
  isLive: boolean;
  forbidden: boolean;
}

export class AdminLiveClient {
  private topics = new Map<AdminLiveTopic, TopicState>();
  private socket: SocketLike | null = null;
  private authenticated = false;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private reauthTimer: unknown = null;
  private idleTimer: unknown = null;
  private hiddenTimer: unknown = null;
  private paused = false;
  /** The channel whose subscribe reply is awaited (subscriptions go one at a time). */
  private pendingSubscribe: AdminLiveTopic | null = null;
  private connecting = false;

  constructor(private deps: ClientDeps) {}

  /** Follows a topic; returns the unsubscribe function. */
  subscribe(topic: AdminLiveTopic, onUpdate: UpdateListener, onLive: LiveListener): () => void {
    let state = this.topics.get(topic);
    if (!state) {
      state = { updates: new Set(), live: new Set(), isLive: false, forbidden: false };
      this.topics.set(topic, state);
    }
    state.updates.add(onUpdate);
    state.live.add(onLive);
    onLive(state.isLive);
    this.clearTimer('idleTimer');
    if (this.socket && this.authenticated) this.subscribeNext();
    else this.ensureConnected();
    return () => {
      state!.updates.delete(onUpdate);
      state!.live.delete(onLive);
      if (state!.updates.size === 0 && state!.live.size === 0) {
        this.topics.delete(topic);
        if (this.socket?.readyState === OPEN && this.authenticated && state!.isLive) {
          this.send({ type: 'unsubscribe', channel: adminLiveChannel(topic) });
        }
      }
      if (this.topics.size === 0) this.idleTimer = this.deps.setTimeout(() => this.close(), IDLE_CLOSE_MS);
    };
  }

  isLive(topic: AdminLiveTopic): boolean {
    return this.topics.get(topic)?.isLive ?? false;
  }

  /** Tab visibility: closes after 5 minutes hidden, reconnects when visible. */
  setVisible(visible: boolean): void {
    if (visible) {
      this.clearTimer('hiddenTimer');
      if (this.paused) {
        this.paused = false;
        this.attempt = 0;
        this.ensureConnected();
      }
      return;
    }
    if (this.hiddenTimer === null) {
      this.hiddenTimer = this.deps.setTimeout(() => {
        this.hiddenTimer = null;
        this.paused = true;
        this.close();
      }, HIDDEN_CLOSE_MS);
    }
  }

  /** Closes the socket; it reopens when a topic needs it (and the tab is visible). */
  close(): void {
    this.clearTimer('reconnectTimer');
    this.clearTimer('idleTimer');
    const socket = this.socket;
    this.teardown();
    if (socket) {
      socket.onclose = null;
      try {
        socket.close(1000, 'idle');
      } catch {
        // already closed
      }
    }
  }

  private ensureConnected(): void {
    if (this.paused || this.socket || this.connecting || this.reconnectTimer !== null || this.topics.size === 0) return;
    void this.connect();
  }

  private async connect(): Promise<void> {
    this.connecting = true;
    let ticket: RealtimeTicket | null = null;
    try {
      ticket = await this.deps.fetchTicket();
    } catch (error) {
      this.deps.log?.('debug', '[admin-live] Ticket request failed', { error: String(error) });
    }
    this.connecting = false;
    if (this.paused || this.topics.size === 0) return;
    if (!ticket) {
      this.scheduleReconnect();
      return;
    }
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(socketUrlOf(ticket.url));
    } catch (error) {
      this.deps.log?.('warn', '[admin-live] Socket could not be opened', { error: String(error) });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const token = ticket.token;
    socket.onopen = () => {
      this.send({ type: 'authenticate', token });
      this.scheduleReauth(ticket!.expiresAt);
    };
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onerror = () => {
      // onclose follows and reconnects
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.teardown();
      this.scheduleReconnect();
    };
  }

  private onMessage(raw: unknown): void {
    let msg: { type?: string; code?: string; channel?: string; data?: unknown };
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'authenticated':
        this.authenticated = true;
        this.attempt = 0;
        this.startHeartbeat();
        this.pendingSubscribe = null;
        this.subscribeNext();
        return;
      case 'subscribed': {
        const topic = msg.channel ? adminLiveTopicOf(msg.channel) : null;
        if (topic && topic === this.pendingSubscribe) this.pendingSubscribe = null;
        if (topic) this.setLive(topic, true);
        this.subscribeNext();
        return;
      }
      case 'error':
        this.onError(msg.code);
        return;
      default: {
        const data = msg.data as AdminLiveUpdate | undefined;
        if (msg.type === ADMIN_LIVE_UPDATE && data && Array.isArray(data.events)) {
          const state = this.topics.get(data.topic);
          for (const listener of state?.updates ?? []) {
            try {
              listener(data);
            } catch (error) {
              this.deps.log?.('warn', '[admin-live] Update listener failed', { topic: data.topic, error: String(error) });
            }
          }
        }
      }
    }
  }

  private onError(code: string | undefined): void {
    if (code === 'AUTH_EXPIRED') {
      // The server dropped the admin channels: get a fresh token and subscribe again
      this.authenticated = false;
      this.pendingSubscribe = null;
      for (const topic of this.topics.keys()) this.setLive(topic, false);
      void this.reauthenticate();
      return;
    }
    if ((code === 'FORBIDDEN' || code === 'SUBSCRIBE_FAILED') && this.pendingSubscribe) {
      // This role may not follow the topic (or the socket is full): the page keeps polling
      const state = this.topics.get(this.pendingSubscribe);
      if (state) state.forbidden = true;
      this.deps.log?.('debug', '[admin-live] Topic refused', { topic: this.pendingSubscribe, code });
      this.pendingSubscribe = null;
      this.subscribeNext();
      return;
    }
    if (code === 'AUTH_FAILED' || code === 'AUTH_REQUIRED') {
      // A token the server refused: start over with a new socket and ticket
      const socket = this.socket;
      this.teardown();
      socket?.close(4001, 'auth');
      this.scheduleReconnect();
    }
  }

  private async reauthenticate(): Promise<void> {
    const ticket = await this.deps.fetchTicket().catch(() => null);
    if (!this.socket || this.socket.readyState !== OPEN) return;
    if (!ticket) {
      const socket = this.socket;
      this.teardown();
      socket.close(4001, 'auth');
      this.scheduleReconnect();
      return;
    }
    this.send({ type: 'authenticate', token: ticket.token });
    this.scheduleReauth(ticket.expiresAt);
  }

  private scheduleReauth(expiresAt?: number): void {
    this.clearTimer('reauthTimer');
    if (!expiresAt) return;
    const wait = Math.max(5_000, expiresAt * 1000 - this.deps.now() - REAUTH_LEAD_MS);
    this.reauthTimer = this.deps.setTimeout(() => {
      this.reauthTimer = null;
      void this.reauthenticate();
    }, wait);
  }

  private subscribeNext(): void {
    if (!this.authenticated || this.pendingSubscribe || this.socket?.readyState !== OPEN) return;
    for (const [topic, state] of this.topics) {
      if (!state.isLive && !state.forbidden) {
        this.pendingSubscribe = topic;
        this.send({ type: 'subscribe', channel: adminLiveChannel(topic) });
        return;
      }
    }
  }

  private setLive(topic: AdminLiveTopic, live: boolean): void {
    const state = this.topics.get(topic);
    if (!state || state.isLive === live) return;
    state.isLive = live;
    for (const listener of state.live) listener(live);
  }

  private startHeartbeat(): void {
    this.clearTimer('heartbeatTimer');
    const beat = () => {
      this.heartbeatTimer = this.deps.setTimeout(() => {
        if (this.socket?.readyState === OPEN) this.send({ type: 'heartbeat', timestamp: this.deps.now() });
        beat();
      }, HEARTBEAT_MS);
    };
    beat();
  }

  private scheduleReconnect(): void {
    if (this.paused || this.topics.size === 0 || this.reconnectTimer !== null) return;
    const delay = backoffMs(this.attempt++, this.deps.random);
    this.deps.log?.('debug', '[admin-live] Reconnecting', { delay, attempt: this.attempt });
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  /** Forgets the socket and marks every topic down (not the listeners). */
  private teardown(): void {
    this.socket = null;
    this.authenticated = false;
    this.pendingSubscribe = null;
    this.clearTimer('heartbeatTimer');
    this.clearTimer('reauthTimer');
    for (const [topic, state] of this.topics) {
      state.forbidden = false;
      this.setLive(topic, false);
    }
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch (error) {
      this.deps.log?.('debug', '[admin-live] Send failed', { error: String(error) });
    }
  }

  private clearTimer(name: 'reconnectTimer' | 'heartbeatTimer' | 'reauthTimer' | 'idleTimer' | 'hiddenTimer'): void {
    if (this[name] !== null) {
      this.deps.clearTimeout(this[name]);
      this[name] = null;
    }
  }
}
