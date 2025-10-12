# WebSocket Server

Real-time WebSocket server infrastructure for Al Ummah Now, built on Cloudflare Durable Objects.

## Features

- **WebSocket Connection Management**: Persistent connections via Cloudflare Durable Objects
- **JWT Authentication**: Secure authentication using OpenAuth tokens
- **Channel Subscriptions**: Subscribe to video, user, and live stream channels
- **Presence Tracking**: Track online/offline status of users
- **Message Broadcasting**: Real-time message delivery to subscribers
- **Rate Limiting**: Per-connection rate limiting (100 messages/minute)
- **Automatic Reconnection**: Client-side reconnection with exponential backoff

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
```

## Message Types

### Client → Server

- `authenticate` - Authenticate with JWT token
- `subscribe` - Subscribe to a channel
- `unsubscribe` - Unsubscribe from a channel
- `message` - Send message to a channel
- `ping` / `heartbeat` - Keep-alive heartbeat

### Server → Client

- `authenticated` - Authentication successful
- `error` - Error message
- `notification` - User notification
- `presence` - User online/offline status
- `video_update` - Video processing status
- `comment` - New comment on video
- `live_chat` - Live stream chat message
- `pong` - Heartbeat response
- `connection_acknowledged` - Connection established
- `subscribed` - Successfully subscribed to channel
- `unsubscribed` - Successfully unsubscribed from channel

## Channel Types

- `user:{userId}` - User notifications (auto-subscribed on auth)
- `video:{videoId}` - Video-specific updates
- `channel:{channelId}` - Channel/room updates
- `live:{channelId}` - Live stream chat

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Type check
pnpm type-check

# Build
pnpm build
```

The server runs on `http://localhost:8787` in development.

## WebSocket Connection

### Connect with Authentication

```javascript
const ws = new WebSocket('ws://localhost:8787/ws?token=YOUR_JWT_TOKEN');
```

### Or Authenticate After Connection

```javascript
const ws = new WebSocket('ws://localhost:8787/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'authenticate',
    token: 'YOUR_JWT_TOKEN'
  }));
};
```

## API Endpoints

### WebSocket Endpoint

`GET /ws` - WebSocket upgrade endpoint

Query parameters:
- `token` (optional) - JWT authentication token
- `userId` (optional) - User ID for reference

### Broadcast Endpoint

`POST /broadcast` - Send messages to channels (server-to-server)

```json
{
  "channel": "video:123",
  "message": {
    "type": "video_update",
    "videoId": "123",
    "status": "processing",
    "data": {}
  }
}
```

### Stats Endpoint

`GET /stats` - Get server statistics

Response:
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

### Health Check

`GET /health` - Health check endpoint

## Integration with Other Services

Use the helper functions from `notify-helpers.ts`:

```typescript
import { notifyUser, notifyVideoUpdate } from './notify-helpers';

// Send user notification
await notifyUser(
  'http://localhost:8787',
  'user-123',
  {
    id: 'notif-1',
    title: 'New Comment',
    message: 'Someone commented on your video',
    type: 'comment',
    actionUrl: '/videos/123'
  }
);

// Notify video update
await notifyVideoUpdate(
  'http://localhost:8787',
  'video-123',
  'ready',
  { resolution: '1080p', duration: 120 }
);
```

## Rate Limiting

- **Per Connection**: 100 messages per minute
- Exceeded connections receive `RATE_LIMIT` error

## Deployment

```bash
# Deploy to Cloudflare
pnpm deploy
```

## Environment Variables

Set these in Cloudflare Workers secrets/environment:

- `Issuer` - OpenAuth issuer URL
- `Audience` - OpenAuth audience
- `ClientId` - OpenAuth client ID

## Security

- JWT token validation with OpenAuth
- Rate limiting per connection
- Channel-based access control
- Automatic session cleanup on disconnect

## Monitoring

Check server stats:
```bash
curl http://localhost:8787/stats
```

Check health:
```bash
curl http://localhost:8787/health
```
