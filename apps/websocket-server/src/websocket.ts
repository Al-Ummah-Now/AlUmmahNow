/**
 * WebSocket Durable Object
 * Handles WebSocket connections, authentication, and message routing
 */

import { DurableObject } from "cloudflare:workers";
import { validateJWT, validateJWTBasic, AuthPayload } from './auth';
import { ChannelManager } from './channels';
import { PresenceManager } from './presence';
import { ClientMessageSchema, ServerMessage, RateLimitInfo } from './messages';

interface WebSocketConnection {
  webSocket: WebSocket;
  sessionId: string;
  userId?: string;
  authenticated: boolean;
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
    const token = url.searchParams.get('token');
    const userId = url.searchParams.get('userId');

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
      userId: userId || undefined,
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
    if (token) {
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
      console.error('Error handling WebSocket message:', error);
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

      console.log(`WebSocket closed: ${connection.sessionId}, code: ${code}, reason: ${reason}`);
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    const connection = this.connections.get(ws);
    if (connection) {
      this.connections.delete(ws);
      this.channelManager.removeSession(connection.sessionId);
    }
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
      // Validate JWT token
      let authPayload: AuthPayload | null = null;

      // Try full validation first (requires env vars to be set)
      const env = this.env as Env;
      if ('Issuer' in env && 'ClientId' in env && env.Issuer && env.ClientId) {
        authPayload = await validateJWT(token, env);
      } else {
        // Fallback to basic validation for development
        authPayload = await validateJWTBasic(token);
      }

      if (!authPayload) {
        this.sendMessage(ws, {
          type: 'error',
          error: 'Invalid or expired token',
          code: 'AUTH_FAILED',
        });
        return;
      }

      // Update connection
      connection.authenticated = true;
      connection.userId = authPayload.sub;

      // Add session to channel manager
      this.channelManager.addSession(connection.sessionId, authPayload.sub);

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
      console.error('Authentication error:', error);
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

    // Require authentication for subscriptions
    if (!connection.authenticated) {
      this.sendMessage(ws, {
        type: 'error',
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
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

    for (const sessionId of subscribers) {
      const socket = this.sessionToWebSocket.get(sessionId);
      if (socket) {
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
      console.error('Error sending WebSocket message:', error);
    }
  }

  /**
   * Broadcast message to a channel
   * Optimized with reverse lookup map for O(n) performance
   */
  async broadcast(channel: string, message: ServerMessage): Promise<void> {
    const subscribers = this.channelManager.getChannelSubscribers(channel);

    for (const sessionId of subscribers) {
      const ws = this.sessionToWebSocket.get(sessionId);
      if (ws) {
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
      console.error('Error handling broadcast request:', error);
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
