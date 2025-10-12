# WebSocket Server Infrastructure Documentation

## Overview

The WebSocket server infrastructure provides real-time communication capabilities for Al Ummah Now platform. Built on Cloudflare Durable Objects, it offers persistent WebSocket connections, channel-based messaging, presence tracking, and JWT authentication.

## Architecture

```
┌─────────────────┐       WebSocket        ┌─────────────────────┐
│   Web Client    │◄──────────────────────►│  Durable Objects    │
│  (apps/web)     │    wss://ws.*.dev      │   (WebSocket)       │
└─────────────────┘                        └─────────────────────┘
                                                      │
                                                      │
                                            ┌─────────▼──────────┐
                                            │   Cloudflare KV    │
                                            │  (Presence State)  │
                                            └────────────────────┘
                                                      ▲
                                                      │
                  ┌───────────────────────────────────┴────────────────────────┐
                  │                                                            │
         ┌────────▼──────────┐                                    ┌───────────▼────────┐
         │   API Videos      │                                    │   Processor        │
         │   (api-videos)    │                                    │   (processor)      │
         └───────────────────┘                                    └────────────────────┘
```

## Components

### 1. WebSocket Durable Object (`apps/websocket-server/src/websocket.ts`)

The core component that handles:
- WebSocket connection lifecycle (connect, message, close, error)
- JWT authentication
- Channel subscriptions and message routing
- Rate limiting (100 messages/minute per connection)
- Session management
- Broadcasting to channels

**Key Methods:**
- `fetch()` - Handles WebSocket upgrades and internal HTTP endpoints
- `webSocketMessage()` - Processes incoming WebSocket messages
- `webSocketClose()` - Cleanup on connection close
- `broadcast()` - Broadcasts messages to channel subscribers

### 2. Channel Manager (`apps/websocket-server/src/channels.ts`)

Manages channel subscriptions and routing:
- Maps channels to subscriber sessions
- Tracks session data (userId, channels, activity)
- Provides channel statistics

**Channel Types:**
- `user:{userId}` - User notifications (auto-subscribed on authentication)
- `video:{videoId}` - Video-specific updates (comments, likes, processing)
- `channel:{channelId}` - Channel/room updates
- `live:{channelId}` - Live stream chat

### 3. Presence Manager (`apps/websocket-server/src/presence.ts`)

Tracks user online/offline status using Cloudflare KV:
- Stores active sessions per user
- Auto-expires after 5 minutes (refreshed by heartbeats)
- Supports bulk presence queries
- Automatic cleanup on disconnect

### 4. Authentication (`apps/websocket-server/src/auth.ts`)

JWT authentication using OpenAuth:
- Validates JWT tokens with signature verification
- Fallback to basic validation for development
- Uses same auth subjects as api-videos
- Supports both URL parameter and message-based auth

## Message Protocol

### Client → Server Messages

#### Authenticate
```json
{
  "type": "authenticate",
  "token": "eyJhbGciOiJSUzI1NiIs..."
}
```

#### Subscribe to Channel
```json
{
  "type": "subscribe",
  "channel": "video:123"
}
```

#### Unsubscribe from Channel
```json
{
  "type": "unsubscribe",
  "channel": "video:123"
}
```

#### Send Message
```json
{
  "type": "message",
  "channel": "live:abc",
  "data": {
    "message": "Hello world!"
  }
}
```

#### Heartbeat
```json
{
  "type": "ping",
  "timestamp": 1234567890
}
```

### Server → Client Messages

#### Connection Acknowledged
```json
{
  "type": "connection_acknowledged",
  "sessionId": "uuid-here"
}
```

#### Authenticated
```json
{
  "type": "authenticated",
  "userId": "user-123",
  "sessionId": "uuid-here"
}
```

#### Subscribed
```json
{
  "type": "subscribed",
  "channel": "video:123"
}
```

#### Notification
```json
{
  "type": "notification",
  "data": {
    "id": "notif-1",
    "userId": "user-123",
    "title": "New Comment",
    "message": "Someone commented on your video",
    "type": "comment",
    "actionUrl": "/videos/123",
    "timestamp": 1234567890
  }
}
```

#### Video Update
```json
{
  "type": "video_update",
  "videoId": "video-123",
  "status": "ready",
  "data": {
    "resolution": "1080p",
    "duration": 120
  }
}
```

#### Comment
```json
{
  "type": "comment",
  "videoId": "video-123",
  "commentId": "comment-456",
  "data": {
    "userId": "user-789",
    "text": "Great video!",
    "timestamp": 1234567890
  }
}
```

#### Presence
```json
{
  "type": "presence",
  "userId": "user-123",
  "status": "online",
  "timestamp": 1234567890
}
```

#### Error
```json
{
  "type": "error",
  "error": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

Error codes:
- `AUTH_FAILED` - Authentication failed
- `AUTH_REQUIRED` - Operation requires authentication
- `AUTH_ERROR` - Authentication error
- `RATE_LIMIT` - Rate limit exceeded
- `SUBSCRIBE_FAILED` - Failed to subscribe to channel
- `UNSUBSCRIBE_FAILED` - Failed to unsubscribe from channel
- `PROCESSING_ERROR` - Failed to process message
- `UNKNOWN_MESSAGE_TYPE` - Unknown message type

#### Pong
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

## HTTP API Endpoints

### GET /ws
WebSocket upgrade endpoint. Accepts optional query parameters:
- `token` - JWT authentication token
- `userId` - User ID for reference

### POST /broadcast
Internal endpoint for server-to-server message broadcasting.

**Request:**
```json
{
  "channel": "video:123",
  "message": {
    "type": "video_update",
    "videoId": "123",
    "status": "ready",
    "data": {}
  }
}
```

**Response:**
```json
{
  "success": true
}
```

### GET /stats
Returns server statistics.

**Response:**
```json
{
  "connections": 42,
  "channels": 15,
  "sessions": 42,
  "channelDetails": {
    "video:123": 5,
    "user:456": 1
  }
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "websocket-server",
  "timestamp": "2025-10-12T00:00:00.000Z"
}
```

## Integration Guide

### From Web Client

The web app already has WebSocket client integration. Update the connection URL in `apps/web/src/lib/websocket/WebSocketProvider.tsx`:

```typescript
const defaultConfig: WebSocketConfig = {
  url: process.env.NODE_ENV === 'production' 
    ? 'wss://realtime.alummahnow.net/ws' 
    : 'ws://localhost:8787/ws',
  // ... rest of config
};
```

### From API Videos

Use the helper functions in `apps/api-videos/src/lib/websocket-notify.ts`:

```typescript
import { notifyUser, notifyComment } from './lib/websocket-notify';

// After creating a comment
await notifyComment(
  env.WEBSOCKET_URL || 'http://localhost:8787',
  videoId,
  commentData
);

// After a like
await notifyUser(
  env.WEBSOCKET_URL || 'http://localhost:8787',
  videoOwnerId,
  {
    id: crypto.randomUUID(),
    title: 'New Like',
    message: `Someone liked your video "${video.title}"`,
    type: 'like',
    actionUrl: `/videos/${videoId}`
  }
);
```

### From Processor

Use the helper functions in `apps/processor/src/lib/websocket-notify.ts`:

```typescript
import { notifyVideoProcessing } from './lib/websocket-notify';

// When processing starts
await notifyVideoProcessing(
  env.WEBSOCKET_URL || 'http://localhost:8787',
  videoId,
  userId,
  'processing'
);

// When processing completes
await notifyVideoProcessing(
  env.WEBSOCKET_URL || 'http://localhost:8787',
  videoId,
  userId,
  'ready',
  { resolution: '1080p', duration: 120 }
);
```

## Environment Variables

Set these in Cloudflare Workers configuration:

```bash
# OpenAuth configuration (same as api-videos)
Issuer=https://auth.alummahnow.net
Audience=alummahnow
ClientId=your-client-id

# WebSocket URL for other services to use
WEBSOCKET_URL=https://realtime.alummahnow.net
```

## Deployment

### Development
```bash
cd apps/websocket-server
pnpm dev
# Server runs on http://localhost:8787
```

### Production
```bash
cd apps/websocket-server
pnpm deploy
```

Or from root:
```bash
pnpm websocket:deploy
```

### Configure Wrangler Secrets

For production JWT validation, configure OpenAuth settings:
```bash
cd apps/websocket-server
wrangler secret put Issuer
wrangler secret put Audience
wrangler secret put ClientId
```

### Configure KV Namespace

The Durable Object migration will automatically create the KV namespace. For production, update the KV namespace IDs in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "PRESENCE_KV",
    "id": "your-production-kv-id",
    "preview_id": "your-preview-kv-id"
  }
]
```

## Monitoring

### Check Server Health
```bash
curl https://realtime.alummahnow.net/health
```

### Check Statistics
```bash
curl https://realtime.alummahnow.net/stats
```

### View Logs
```bash
cd apps/websocket-server
wrangler tail
```

## Security

### Authentication
- All subscriptions require authentication
- JWT tokens validated with OpenAuth
- User channels auto-subscribed on authentication

### Rate Limiting
- 100 messages per minute per connection
- Exceeded connections receive `RATE_LIMIT` error
- Rate limits reset every minute

### Channel Access Control
- Users can only send messages to channels they're subscribed to
- Subscriptions require authentication
- User channels are private (auto-subscribed only)

## Performance

### Scalability
- Single Durable Object instance handles multiple connections
- Can be sharded by user ID or channel for horizontal scaling
- KV-based presence tracking for cross-instance state

### Connection Limits
- No hard connection limit (Cloudflare handles)
- Monitor stats endpoint for capacity planning
- Consider sharding at ~1000 connections per instance

### Message Throughput
- Rate limited to 100 messages/minute per connection
- Broadcast messages sent to all channel subscribers
- Efficient message routing via channel manager

## Troubleshooting

### Connection Issues
1. Check WebSocket URL is correct
2. Verify CORS settings allow your domain
3. Check JWT token is valid and not expired
4. Review browser console for errors

### Authentication Failures
1. Verify OpenAuth environment variables are set
2. Check JWT token format and signature
3. Ensure issuer and audience match
4. Review auth logs in Wrangler

### Message Delivery Issues
1. Verify channel subscription succeeded
2. Check sender is authenticated
3. Review rate limiting status
4. Check stats endpoint for active connections

### Presence Tracking Issues
1. Verify KV namespace is configured
2. Check heartbeat messages are being sent
3. Review KV TTL settings (default 5 minutes)
4. Monitor KV operations in Cloudflare dashboard

## Testing

### Unit Tests
```bash
cd apps/websocket-server
pnpm test
```

### Manual Testing
Use the test script:
```bash
node /tmp/websocket-test.js
```

Or use a WebSocket client like `wscat`:
```bash
npm install -g wscat
wscat -c ws://localhost:8787/ws
```

## Future Enhancements

- [ ] Horizontal sharding by user ID or channel
- [ ] Persistent message history
- [ ] Message acknowledgments
- [ ] Typed messages with Zod validation
- [ ] Metrics and analytics
- [ ] Admin API for connection management
- [ ] WebSocket compression
- [ ] Binary message support
- [ ] Client library for easier integration
