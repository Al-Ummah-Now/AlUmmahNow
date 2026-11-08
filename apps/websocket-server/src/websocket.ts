/**
 * WebSocket Durable Object
 * Handles WebSocket connections, authentication, and message routing
 */

import { DurableObject } from "cloudflare:workers";
import { authenticateToken, canPublish, canSubscribe, canSubscribeAnonymously } from './auth';
import { ChannelManager } from './channels';
import { PresenceManager } from './presence';
import { ClientMessageSchema, ServerMessage, RateLimitInfo } from './messages';
import { logger } from './lib/logger';

interface WebSocketConnection {
  webSocket: WebSocket;
  sessionId: string;
  userId?: string;
  authenticated: boolean;
  /** Unix seconds when the token the socket authenticated with expires (#437). */
  authExpiresAt?: number;
  connectedAt: number;
}

export class WebSocketDurableObject extends DurableObject {
  private connections: Map<WebSocket, WebSocketConnection> = new Map();
  private sessionToWebSocket: Map<string, WebSocket> = new Map();
  private channelManager: ChannelManager = new ChannelManager();
  private presenceManager: PresenceManager;
  private rateLimits: Map<string, RateLimitInfo> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.presenceManager = new PresenceManager(env.PRESENCE_KV);
  }

  /**
   * Handle HTTP upgrade to WebSocket and internal endpoints
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal broadcast endpoint
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return await this.handleBroadcastRequest(request);
    }

    // Handle internal stats endpoint
    if (url.pathname === '/stats' && request.method === 'GET') {
      return this.handleStatsRequest();
    }

    // Check if this is a WebSocket upgrade request
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Check connection limit
    const env = this.env as Env;
    const maxConnections = env.MAX_CONNECTIONS_PER_DO || 1000;
    if (this.connections.size >= maxConnections) {
      return new Response('Connection limit reached', { status: 503 });
    }

    // Parse URL for authentication parameters
    // Only `token` is read. A `userId` query param is deliberately ignored: the
    // connection's identity comes solely from a verified token.
    const token = url.searchParams.get('token');

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    this.ctx.acceptWebSocket(server);

    // Create session ID
    const sessionId = crypto.randomUUID();

    // Store connection info
    const connection: WebSocketConnection = {
      webSocket: server,
      sessionId,
      userId: undefined,
      authenticated: false,
      connectedAt: Date.now(),
    };

    this.connections.set(server, connection);
    
    // Store reverse lookup for efficient broadcasting
    this.sessionToWebSocket.set(sessionId, server);

    // Send connection acknowledgment
    this.sendMessage(server, {
      type: 'connection_acknowledged',
      sessionId,
    });

    // If token is provided in URL, attempt authentication
    // DEPRECATION: Token in URL is a security risk (exposed in logs, browser history)
    // Clients should send token via 'authenticate' message after connection
    if (token) {
      logger.warn('DEPRECATED: Token received in URL. Client should use authenticate message instead.', {
        sessionId,
      });
      await this.handleAuthentication(server, token);
    }

    // Return the client WebSocket for the response
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const connection = this.connections.get(ws);
      if (!connection) {
        return;
      }

      // Rate limiting check
      if (!this.checkRateLimit(connection.sessionId)) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT',
        });
        return;
      }

      // Parse and validate message
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      
      // Check message size limit (100KB)
      if (data.length > 100000) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Message too large',
          code: 'PAYLOAD_TOO_LARGE',
        });
        return;
      }
      
      const parsedData = JSON.parse(data);
      
      // Validate with Zod schema
      const validationResult = ClientMessageSchema.safeParse(parsedData);
      if (!validationResult.success) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Invalid message format',
          code: 'INVALID_MESSAGE',
        });
        return;
      }
      
      const clientMessage = validationResult.data;

      // A socket stays signed in only as long as its token (#437). Before a
      // re-auth too, so a failed one leaves the socket signed out.
      this.expireAuthIfNeeded(ws, { notify: clientMessage.type !== 'authenticate' });

      // Handle different message types
      switch (clientMessage.type) {
        case 'authenticate':
          await this.handleAuthentication(ws, clientMessage.token);
          break;

        case 'subscribe':
          await this.handleSubscribe(ws, clientMessage.channel);
          break;

        case 'unsubscribe':
          await this.handleUnsubscribe(ws, clientMessage.channel);
          break;

        case 'message':
          await this.handleMessage(ws, clientMessage.channel, clientMessage.data);
          break;

        case 'ping':
        case 'heartbeat':
          await this.handleHeartbeat(ws, clientMessage.timestamp);
          break;

        default:
          this.sendMessage(ws, {
            type: 'error',
            error: 'Unknown message type',
            code: 'UNKNOWN_MESSAGE_TYPE',
          });
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      this.sendMessage(ws, {
        type: 'error',
        error: 'Failed to process message',
        code: 'PROCESSING_ERROR',
      });
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    const connection = this.connections.get(ws);
    if (connection) {
      // Remove from channel subscriptions
      this.channelManager.removeSession(connection.sessionId);

      // Update presence
      if (connection.authenticated && connection.userId) {
        await this.presenceManager.setOffline(connection.userId, connection.sessionId);
      }

      // Clean up rate limits to prevent memory leak
      this.rateLimits.delete(connection.sessionId);

      // Remove from reverse lookup map
      this.sessionToWebSocket.delete(connection.sessionId);

      // Remove connection
      this.connections.delete(ws);

      logger.debug(`WebSocket closed: ${connection.sessionId}, code: ${code}, reason: ${reason}`);
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.error('WebSocket error:', error);
    const connection = this.connections.get(ws);
    if (connection) {
      this.connections.delete(ws);
      this.channelManager.removeSession(connection.sessionId);
    }
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
    const connection = this.connections.get(ws);
    if (!connection?.authenticated || connection.authExpiresAt === undefined || nowSeconds < connection.authExpiresAt) {
      return false;
    }
    const session = this.channelManager.getSession(connection.sessionId);
    for (const channel of [...(session?.channels ?? [])]) {
      if (!canSubscribeAnonymously(channel)) this.channelManager.unsubscribe(connection.sessionId, channel);
    }
    connection.authenticated = false;
    if (notify) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Token expired; authenticate again',
        code: 'AUTH_EXPIRED',
      });
    }
    return true;
  }

  /** A private channel's message must not reach a socket whose token has expired, even a silent one. */
  private expiredForChannel(ws: WebSocket, channel: string): boolean {
    return !canSubscribeAnonymously(channel) && this.expireAuthIfNeeded(ws);
  }

  /**
   * Handle authentication
   */
  private async handleAuthentication(ws: WebSocket, token: string): Promise<void> {
    const connection = this.connections.get(ws);
    if (!connection) {
      return;
    }

    try {
      // Signature, issuer, expiry and client are checked in authenticateToken;
      // unsigned tokens are only accepted when ENVIRONMENT=development.
      const authPayload = await authenticateToken(token, this.env as Env);

      if (!authPayload) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Invalid or expired token',
          code: 'AUTH_FAILED',
        });
        return;
      }

      // A connection cannot switch to a different user; re-auth is only a token refresh.
      if (connection.authenticated && connection.userId !== authPayload.sub) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Connection is already authenticated as another user',
          code: 'AUTH_FAILED',
        });
        return;
      }

      // Update connection
      connection.authenticated = true;
      connection.userId = authPayload.sub;
      connection.authExpiresAt = authPayload.exp;

      // Add session to channel manager (a re-auth keeps the session and its channels)
      const existingSession = this.channelManager.getSession(connection.sessionId);
      if (existingSession) existingSession.userId = authPayload.sub;
      else this.channelManager.addSession(connection.sessionId, authPayload.sub);

      // Update presence
      await this.presenceManager.setOnline(authPayload.sub, connection.sessionId);

      // Send success response
      this.sendMessage(ws, {
        type: 'authenticated',
        userId: authPayload.sub,
        sessionId: connection.sessionId,
      });

      // Auto-subscribe to user's notification channel
      const userChannel = `user:${authPayload.sub}`;
      this.channelManager.subscribe(connection.sessionId, userChannel);

    } catch (error) {
      logger.error('Authentication error:', error);
      this.sendMessage(ws, {
        type: 'error',
        error: 'Authentication failed',
        code: 'AUTH_ERROR',
      });
    }
  }

  /**
   * Handle channel subscription
   */
  private async handleSubscribe(ws: WebSocket, channel: string): Promise<void> {
    const connection = this.connections.get(ws);
    if (!connection) {
      return;
    }

    // Signed-out viewers may follow public video feeds; everything else needs a token.
    if (!connection.authenticated && !canSubscribeAnonymously(channel)) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    // user:<id> channels carry private notifications; only that user may join.
    if (connection.authenticated && (!connection.userId || !canSubscribe(connection.userId, channel))) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Not allowed to subscribe to this channel',
        code: 'FORBIDDEN',
      });
      return;
    }

    // Subscribe to channel
    const success = this.channelManager.subscribe(connection.sessionId, channel);

    if (success) {
      this.sendMessage(ws, {
        type: 'subscribed',
        channel,
      });
    } else {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Failed to subscribe to channel',
        code: 'SUBSCRIBE_FAILED',
      });
    }
  }

  /**
   * Handle channel unsubscription
   */
  private async handleUnsubscribe(ws: WebSocket, channel: string): Promise<void> {
    const connection = this.connections.get(ws);
    if (!connection) {
      return;
    }

    const success = this.channelManager.unsubscribe(connection.sessionId, channel);

    if (success) {
      this.sendMessage(ws, {
        type: 'unsubscribed',
        channel,
      });
    } else {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Failed to unsubscribe from channel',
        code: 'UNSUBSCRIBE_FAILED',
      });
    }
  }

  /**
   * Handle message broadcasting
   */
  private async handleMessage(ws: WebSocket, channel: string, data: any): Promise<void> {
    const connection = this.connections.get(ws);
    if (!connection || !connection.authenticated) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    // Clients may not post into user:<id> channels; those are fed by /broadcast only.
    if (!canPublish(channel)) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Not allowed to publish to this channel',
        code: 'FORBIDDEN',
      });
      return;
    }

    // Get all subscribers to this channel
    const subscribers = this.channelManager.getChannelSubscribers(channel);

    // Broadcast message in proper format to all subscribers
    const message: ServerMessage = {
      type: 'message',
      channel,
      data,
      from: connection.userId,
      timestamp: Date.now(),
    };

    for (const sessionId of [...subscribers]) {
      const socket = this.sessionToWebSocket.get(sessionId);
      if (socket && !this.expiredForChannel(socket, channel)) {
        this.sendMessage(socket, message);
      }
    }
  }

  /**
   * Handle heartbeat
   */
  private async handleHeartbeat(ws: WebSocket, _timestamp: number): Promise<void> {
    const connection = this.connections.get(ws);
    if (!connection) {
      return;
    }

    // Update activity
    this.channelManager.updateActivity(connection.sessionId);

    // Refresh presence if authenticated
    if (connection.authenticated && connection.userId) {
      await this.presenceManager.refresh(connection.userId, connection.sessionId);
    }

    // Send pong response
    this.sendMessage(ws, {
      type: 'pong',
      timestamp: Date.now(),
    });
  }

  /**
   * Check rate limit for a session
   */
  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(sessionId);

    // Rate limit: configurable via environment variables
    const env = this.env as Env;
    const maxMessages = env.RATE_LIMIT_MESSAGES || 100;
    const windowMs = env.RATE_LIMIT_WINDOW_MS || 60000; // Default 1 minute

    if (!limit || now > limit.resetAt) {
      // Reset or create new limit
      this.rateLimits.set(sessionId, {
        count: 1,
        resetAt: now + windowMs,
      });
      return true;
    }

    if (limit.count >= maxMessages) {
      return false;
    }

    // Increment count
    limit.count++;
    return true;
  }

  /**
   * Send a message to a WebSocket
   */
  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Error sending WebSocket message:', error);
    }
  }

  /**
   * Broadcast message to a channel
   * Optimized with reverse lookup map for O(n) performance
   */
  async broadcast(channel: string, message: ServerMessage): Promise<void> {
    const subscribers = this.channelManager.getChannelSubscribers(channel);

    for (const sessionId of [...subscribers]) {
      const ws = this.sessionToWebSocket.get(sessionId);
      if (ws && !this.expiredForChannel(ws, channel)) {
        this.sendMessage(ws, message);
      }
    }
  }

  /**
   * Handle internal broadcast request
   */
  private async handleBroadcastRequest(request: Request): Promise<Response> {
    try {
      const { channel, message } = await request.json() as { channel: string; message: ServerMessage };

      if (!channel || !message) {
        return new Response(JSON.stringify({ error: 'Missing channel or message' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await this.broadcast(channel, message);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Error handling broadcast request:', error);
      return new Response(JSON.stringify({ error: 'Failed to broadcast' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Handle internal stats request
   */
  private handleStatsRequest(): Response {
    const stats = this.channelManager.getStats();

    return new Response(JSON.stringify({
      connections: this.connections.size,
      channels: stats.totalChannels,
      sessions: stats.totalSessions,
      channelDetails: Object.fromEntries(stats.channels),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
