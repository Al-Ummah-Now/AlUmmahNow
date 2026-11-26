import {
  WebSocketConfig,
  WebSocketConnectionState,
  WebSocketMessage,
  WebSocketSubscription,
  WebSocketEventType
} from '@/interfaces/websocket';
import { ACCESS_CHANGED_EVENT } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';
import { sanitizeEventPayload, validateStructure } from '@/lib/security/InputSanitizer';

/** Frames a live chat's subscribers get from this client (never from the server). */
export const REALTIME_JOINED = 'realtime_joined';
export const REALTIME_LEFT = 'realtime_left';

const AUTH_RETRY_CLOSE_CODE = 4001;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private state: WebSocketConnectionState;
  private subscriptions: Map<string, WebSocketSubscription[]> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageQueue: WebSocketMessage[] = [];
  /** True once the server has accepted our authenticate message on this socket. */
  private authenticated = false;
  /** Server acknowledged a socket that will never authenticate (signed-out viewer). */
  private anonymousReady = false;
  /** Live chats the server confirmed on this socket (`live:<streamId>`, wiki E17 §5.3). */
  private joined: Set<string> = new Set();
  private eventListeners: Map<string, Set<(data: WebSocketConnectionState) => void>> = new Map();

  /** Set the token sent in the authenticate message on (re)connect. */
  setAuthToken(token: string | undefined): void {
    this.config.authToken = token;
    if (token && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendAuthMessage(token);
    }
  }

  constructor(config: WebSocketConfig) {
    this.config = {
      ...config,
      reconnectInterval: config.reconnectInterval ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      heartbeatInterval: config.heartbeatInterval ?? 30000
    };

    this.state = {
      status: 'disconnected',
      reconnectAttempts: 0,
      maxReconnectAttempts: this.config.maxReconnectAttempts
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(userId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state.status === 'connected' || this.state.status === 'connecting') {
        resolve();
        return;
      }

      this.state.status = 'connecting';

      try {
        // SECURITY: Never send the token in the URL; it goes in the first message.
        // No userId either: the server takes identity only from the verified token.
        void userId;
        const wsUrl = this.config.url;

        logger.debug('🔌 Connecting to WebSocket:', wsUrl);

        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        this.ws.onopen = () => {
          logger.debug('✅ WebSocket connected');
          this.state.status = 'connected';
          this.authenticated = false;
          this.anonymousReady = false;
          this.state.lastConnected = new Date();
          // A signed-in connection has recovered once its credential is accepted.
          if (!this.config.getAuthToken && !this.config.authToken) this.state.reconnectAttempts = 0;

          // SECURITY: Send auth token via first message, not URL
          void this.authenticate();

          this.startHeartbeat();
          this.flushMessageQueue();
          this.notifyStateChange();

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            // Story 1.2 AC 5: sanitize before the message is dispatched to handlers
            // (drops prototype-pollution keys, non-JSON values, control characters,
            // oversized structures). Text stays intact because React escapes it.
            const { value: message, modified } = sanitizeEventPayload<WebSocketMessage>(
              JSON.parse(typeof event.data === 'string' ? event.data : ''),
              { stripMarkup: false, maxDepth: 8, maxStringLength: 10_000, maxArrayLength: 500 }
            );
            const shape = validateStructure(message, { required: { type: 'string' } });
            if (!shape.valid) {
              logger.warn('[WebSocket] Dropping malformed message', { errors: shape.errors });
              return;
            }
            if (modified) {
              logger.debug('[WebSocket] Message sanitized before dispatch', { type: message.type });
            }
            this.handleMessage(message);
          } catch (error) {
            logger.error('❌ Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          this.authenticated = false;
          this.anonymousReady = false;
          [...this.joined].forEach((channel) => this.setJoined(channel, false));
          logger.debug('🔌 WebSocket closed', { code: event.code, reason: event.reason });
          this.state.status = 'disconnected';
          this.stopHeartbeat();
          this.notifyStateChange();

          if (
            this.ws === socket &&
            (!event.wasClean || event.code === AUTH_RETRY_CLOSE_CODE) &&
            this.state.reconnectAttempts < this.config.maxReconnectAttempts
          ) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          // A dropped connection (network change, sleeping tab) is normal; it reconnects
          logger.warn('WebSocket error (will reconnect):', error);
          this.state.status = 'error';
          this.notifyStateChange();
          reject(error);
        };

      } catch (error) {
        this.state.status = 'error';
        this.notifyStateChange();
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
    }

    this.ws = null;
    this.state.status = 'disconnected';
    this.notifyStateChange();
  }

  /**
   * Subscribe to a channel for real-time updates
   */
  subscribe(channel: string, callback: (data: unknown) => void): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, []);
    }

    const subscription: WebSocketSubscription = { channel, callback };
    this.subscriptions.get(channel)!.push(subscription);

    // The server only accepts subscriptions from an authenticated socket. Before
    // that, the channel is kept and sent by resubscribeAll() once authenticated.
    if (this.canSendSubscribe(channel)) {
      this.sendChannelMessage('subscribe', channel);
    }

    logger.debug(`📡 Subscribed to channel: ${channel}`);

    // Return unsubscribe function
    return () => {
      const channelSubs = this.subscriptions.get(channel);
      if (channelSubs) {
        const index = channelSubs.findIndex(sub => sub === subscription);
        if (index !== -1) {
          channelSubs.splice(index, 1);
          logger.debug(`📡 Unsubscribed from channel: ${channel}`);

          if (channelSubs.length === 0) {
            this.subscriptions.delete(channel);
            this.joined.delete(channel);
            if (this.canSendSubscribe(channel)) {
              this.sendChannelMessage('unsubscribe', channel);
            }
          }
        }
      }
    };
  }

  /**
   * Send a subscribe/unsubscribe frame. The server schema expects `channel` at
   * the top level; `data.channel` is kept for older server builds.
   */
  private sendChannelMessage(type: 'subscribe' | 'unsubscribe', channel: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return; // re-sent by resubscribeAll() after the next authentication
    }
    try {
      this.ws.send(JSON.stringify({
        id: this.generateMessageId(),
        type,
        timestamp: Date.now(),
        channel,
        data: { channel },
      }));
      logger.debug('📤 Sent channel message', { type, channel });
    } catch (error) {
      logger.error('❌ Error sending channel message:', error);
    }
  }

  /** Signed-out sockets may join public video feeds and public live chats only (see the server's canSubscribeAnonymously). */
  private canSendSubscribe(channel: string): boolean {
    return this.authenticated || (this.anonymousReady && (channel.startsWith('video:') || channel.startsWith('live:')));
  }

  /**
   * A live chat's subscribers learn when the server confirms it and when it is gone, as frames of their own
   * (REALTIME_JOINED, REALTIME_LEFT): they poll in between.
   */
  private setJoined(channel: string, joined: boolean): void {
    if (joined === this.joined.has(channel) && !joined) return;
    if (joined) this.joined.add(channel);
    else this.joined.delete(channel);
    this.deliver(channel, { type: joined ? REALTIME_JOINED : REALTIME_LEFT });
  }

  private deliver(channel: string, data: unknown): void {
    [...(this.subscriptions.get(channel) ?? [])].forEach((sub) => {
      try {
        sub.callback(data);
      } catch (error) {
        logger.error('❌ Error in subscription callback:', error);
      }
    });
  }

  /** Asks again for the live chats: the server put this socket out of them, and answers those it may still read. */
  private rejoinLiveChats(only?: string): void {
    this.subscriptions.forEach((_subs, channel) => {
      if (!channel.startsWith('live:') || (only && channel !== only)) return;
      this.setJoined(channel, false);
      if (this.canSendSubscribe(channel)) this.sendChannelMessage('subscribe', channel);
    });
  }

  /** (Re)send every active subscription, e.g. after (re)authentication. */
  private resubscribeAll(): void {
    this.subscriptions.forEach((_subs, channel) => {
      if (this.canSendSubscribe(channel)) this.sendChannelMessage('subscribe', channel);
    });
  }

  /**
   * Send a message to the WebSocket server
   */
  sendMessage(type: WebSocketEventType, data: unknown): void {
    const message: WebSocketMessage = {
      id: this.generateMessageId(),
      type,
      timestamp: Date.now(),
      data
    };

    if (this.state.status === 'connected' && this.ws) {
      try {
        this.ws.send(JSON.stringify(message));
        logger.debug('📤 Sent message', { type, data });
      } catch (error) {
        logger.error('❌ Error sending message:', error);
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
      logger.debug('📤 Message queued', { type, data });
    }
  }

  /**
   * Add event listener for connection state changes
   */
  onStateChange(callback: (state: WebSocketConnectionState) => void): () => void {
    const listeners = this.eventListeners.get('stateChange') || new Set();
    listeners.add(callback);
    this.eventListeners.set('stateChange', listeners);

    return () => {
      listeners.delete(callback);
    };
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketConnectionState {
    return { ...this.state };
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  private handleMessage(message: WebSocketMessage): void {
    logger.debug('📥 Received message', { type: message.type, data: message.data });

    // Handle connection acknowledgment
    if (message.type === 'connection_acknowledged') {
      logger.debug('✅ Connection acknowledged by server');
      if (!this.config.getAuthToken && !this.config.authToken) {
        this.anonymousReady = true;
        this.resubscribeAll();
      }
      return;
    }

    // Handle authentication response
    if (message.type === 'authenticated') {
      logger.debug('🔐 Authentication successful', { userId: (message.data as { userId?: string })?.userId });
      this.authenticated = true;
      this.state.reconnectAttempts = 0;
      this.resubscribeAll();
      return;
    }

    // The socket's token expired (#437): authenticate again with a fresh one
    // (getAuthToken refreshes); private channels come back via resubscribeAll
    // The server puts `code` at the top level of error frames
    const errorCode = message.type === 'error'
      ? ((message as { code?: string }).code ?? (message.data as { code?: string } | undefined)?.code)
      : undefined;
    if (errorCode === 'AUTH_EXPIRED') {
      this.authenticated = false;
      // The server put this socket out of its chats with it; a new token joins them again
      [...this.joined].forEach((channel) => this.setJoined(channel, false));
      void this.authenticate();
      return;
    }

    if (errorCode === 'AUTH_FAILED' && this.config.getAuthToken) {
      // An expired or lost single-use ticket needs a fresh handshake.
      this.ws?.close(AUTH_RETRY_CLOSE_CODE, 'Retry authentication');
      return;
    }

    // Handle auth error
    if (errorCode?.startsWith('AUTH')) {
      logger.error('🔐 Authentication failed:', message.data);
      return;
    }

    if ((message.type as string) === 'subscribed') {
      if (message.channel?.startsWith('live:') && this.subscriptions.has(message.channel)) this.setJoined(message.channel, true);
      return;
    }
    // What this person may see changed (a ban, a channel role): every live chat is asked for again
    if ((message.type as string) === ACCESS_CHANGED_EVENT) {
      this.rejoinLiveChats();
    }

    // Handle heartbeat
    if (message.type === 'heartbeat') {
      this.sendMessage('heartbeat', { timestamp: Date.now() });
      return;
    }

    // Route message to appropriate subscribers. Server broadcasts name their
    // channel explicitly; older message shapes are routed by type + payload ids.
    // Notifications are delivered below to every subscriber, so skip them here.
    const channelKey = message.type === 'notification'
      ? null
      : (typeof message.channel === 'string' && this.subscriptions.has(message.channel)
        ? message.channel
        : this.getChannelKeyFromMessage(message));
    if (channelKey) {
      this.deliver(channelKey, message.data);
      // The server ended every subscription to this chat with that frame
      if ((message.type as string) === 'live_chat_closed') this.rejoinLiveChats(channelKey);
    }

    // Broadcast to all subscribers for certain message types
    if (['notification', 'presence_update'].includes(message.type)) {
      this.subscriptions.forEach(subscribers => {
        subscribers.forEach(sub => {
          try {
            sub.callback(message.data);
          } catch (error) {
            logger.error('❌ Error in broadcast callback:', error);
          }
        });
      });
    }
  }

  private getChannelKeyFromMessage(message: WebSocketMessage): string | null {
    const { type, data } = message;

    // Type guard to check if data has videoId or channelId
    const hasVideoId = (obj: unknown): obj is { videoId: string } => {
      return typeof obj === 'object' && obj !== null && 'videoId' in obj && typeof (obj as { videoId: string }).videoId === 'string';
    };

    const hasChannelId = (obj: unknown): obj is { channelId: string } => {
      return typeof obj === 'object' && obj !== null && 'channelId' in obj && typeof (obj as { channelId: string }).channelId === 'string';
    };

    switch (type) {
      case 'comment_added':
      case 'comment_updated':
      case 'comment_deleted':
      case 'video_liked':
      case 'video_unliked':
      case 'view_count_updated':
        return hasVideoId(data) ? `video:${data.videoId}` : null;
      case 'user_joined':
      case 'user_left':
        return hasChannelId(data) ? `channel:${data.channelId}` : null;
      default:
        return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.state.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.state.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    logger.debug(`🔄 Scheduling reconnect attempt ${this.state.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(error => {
        if (this.state.reconnectAttempts < this.config.maxReconnectAttempts) {
          logger.warn('Reconnect failed, retrying:', error);
          this.scheduleReconnect();
        } else {
          logger.error('Realtime connection gave up after all reconnect attempts', { attempts: this.state.reconnectAttempts, error });
        }
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.state.status === 'connected') {
        this.sendMessage('heartbeat', { timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.ws) {
        try {
          this.ws.send(JSON.stringify(message));
          logger.debug('📤 Sent queued message', { type: message.type, data: message.data });
        } catch (error) {
          logger.error('❌ Error sending queued message:', error);
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }

  private notifyStateChange(): void {
    const listeners = this.eventListeners.get('stateChange');
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(this.state);
        } catch (error) {
          logger.error('❌ Error in state change callback:', error);
        }
      });
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Fetch a fresh WebSocket credential for each authentication when a getter is configured.
   */
  private async authenticate(): Promise<void> {
    const socket = this.ws;
    try {
      const token = this.config.getAuthToken
        ? await this.config.getAuthToken()
        : this.config.authToken;
      if (token && this.ws === socket && socket?.readyState === WebSocket.OPEN) {
        this.sendAuthMessage(token);
      }
    } catch (error) {
      // Realtime stays signed out until the next reconnect asks again: not an error of the page
      logger.warn('[WebSocket] No realtime credential for now', error);
    }
  }

  /**
   * Send authentication message to server
   * SECURITY: Token sent via message, not URL (prevents logging/exposure)
   */
  private sendAuthMessage(token: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('❌ Cannot send auth message: WebSocket not open');
      return;
    }

    try {
      // Send in format expected by server's ClientMessageSchema
      const authMessage = {
        type: 'authenticate',
        token: token,
      };
      this.ws.send(JSON.stringify(authMessage));
      logger.debug('🔐 Sent authentication message');
    } catch (error) {
      logger.error('❌ Error sending auth message:', error);
    }
  }
}
