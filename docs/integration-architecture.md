# Al Ummah Now - Integration Architecture

## Overview

Al Ummah Now is a **microservices architecture** deployed on Cloudflare Workers, consisting of 4 main services that communicate through well-defined integration patterns. This document describes how the parts interact, data flows, and communication protocols.

## Service Architecture

```
┌─────────────────┐    HTTP/HTTPS    ┌─────────────────┐
│   Web Frontend │ ◄──────────────► │   API Videos    │
│   (Next.js)    │                  │   (Hono)        │
└─────────┬───────┘                  └─────────┬───────┘
          │                                    │
          │ WebSocket                           │ Queue
          ▼                                    ▼
┌─────────────────┐                  ┌─────────────────┐
│ WebSocket Server│                  │   Processor     │
│ (Durable Obj)  │                  │ (Queue Consumer)│
└─────────────────┘                  └─────────────────┘
```

## Integration Points

### 1. Frontend ↔ API Videos Integration

#### Communication Protocol: **HTTP/HTTPS REST API**
- **Base URL**: `https://videos.api.alummahnow.net`
- **Authentication**: JWT Bearer tokens via OpenAuth
- **Documentation**: OpenAPI 3.1 with interactive Swagger UI

#### Key Integration Patterns:

**Authentication Flow:**
```typescript
// Frontend authentication
const token = await authenticateWithOpenAuth();
localStorage.setItem('jwt_token', token);

// API request with authentication
const response = await fetch('https://videos.api.alummahnow.net/api/videos', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

**API Client Integration:**
```typescript
// apps/web/src/lib/api/videos.ts
import { VideoObject } from '@al-ummah/shared-types';

export class VideoAPI {
  private baseURL = process.env.NEXT_PUBLIC_API_URL;
  
  async getVideos(params: VideoSearchParams): Promise<PaginatedResponse<VideoObject>> {
    const response = await fetch(`${this.baseURL}/api/videos?${new URLSearchParams(params)}`);
    return response.json();
  }
}
```

#### Data Contracts:
- **Request/Response**: Shared TypeScript types from `@al-ummah/shared-types`
- **Error Handling**: Standardized API error responses
- **Pagination**: Consistent pagination parameters across all endpoints

### 2. API Videos ↔ Processor Integration

#### Communication Protocol: **Cloudflare Queue**
- **Queue Name**: `al-ummah-now-videos`
- **Message Format**: JSON with standardized schema
- **Processing**: Batch processing (max 10 messages, 30s timeout)

#### Queue Message Types:

**Video Events:**
```typescript
interface VideoViewMessage {
  type: 'video_view';
  data: {
    videoId: string;
    userId?: string;
    timestamp: string;
    ipAddress: string;
    userAgent: string;
  };
}

interface VideoLikeMessage {
  type: 'video_like' | 'video_dislike';
  data: {
    videoId: string;
    userId: string;
    action: 'create' | 'delete';
    timestamp: string;
  };
}
```

**Profile Events:**
```typescript
interface ProfileUpdateMessage {
  type: 'profile_update';
  data: {
    userId: string;
    changes: Partial<User>;
    timestamp: string;
  };
}
```

#### Processing Flow:
```typescript
// apps/processor/src/index.ts
export default {
  async queue(batch: MessageBatch): Promise<void> {
    for (const message of batch.messages) {
      const { type, data } = JSON.parse(message.body);
      
      switch (type) {
        case 'video_view':
          await processVideoView(data);
          break;
        case 'video_like':
          await processVideoLike(data);
          break;
        // ... 35+ message types
      }
      
      message.ack();
    }
  }
};
```

### 3. Processor ↔ WebSocket Server Integration

#### Communication Protocol: **HTTP Notifications**
- **Trigger**: Processor sends notifications after processing events
- **Endpoint**: WebSocket server internal API
- **Purpose**: Real-time updates to connected clients

#### Notification Pattern:
```typescript
// apps/processor/src/lib/websocket-notify.ts
export async function notifyWebSocketClients(event: WebSocketEvent) {
  const response = await fetch('https://ws.alummahnow.net/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: event.type,
      channel: event.channel,
      data: event.data,
      timestamp: new Date().toISOString()
    })
  });
}
```

#### Event Types:
- **Video Updates**: New uploads, processing status changes
- **Engagement**: Real-time like/comment counts
- **Channel Activity**: New subscribers, live stream starts
- **User Presence**: Online status, watch progress

### 4. WebSocket Server ↔ Frontend Integration

#### Communication Protocol: **WebSocket**
- **URL**: `wss://ws.alummahnow.net`
- **Authentication**: JWT token in connection URL
- **State Management**: Durable Objects for connection state

#### WebSocket Connection Flow:
```typescript
// apps/web/src/lib/websocket/WebSocketManager.ts
export class WebSocketManager {
  private ws: WebSocket | null = null;
  
  connect(user: User, token: string) {
    const wsUrl = `wss://ws.alummahnow.net?token=${token}&userId=${user.id}`;
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
  }
  
  subscribe(channel: string, params?: any) {
    this.send({
      type: 'subscribe',
      channel,
      params
    });
  }
}
```

#### Channel Subscriptions:
```typescript
// Available subscription channels
interface SubscriptionChannels {
  'user:{userId}': UserNotifications;      // Personal notifications
  'video:{videoId}': VideoUpdates;        // Video-specific updates
  'channel:{channelId}': ChannelActivity; // Channel notifications
  'live:{streamId}': LiveStreamUpdates;  // Live stream events
}
```

## Data Flow Architecture

### 1. Video Upload Flow

```
Frontend → API Videos → R2 Storage → Queue → Processor → WebSocket → Frontend
    │           │            │           │          │           │
    │           │            │           │          │           │
    ▼           ▼            ▼           ▼          ▼           ▼
Upload Form → Upload API → Bunny.net → Queue → Process → Notify → UI Update
```

**Step-by-Step:**
1. **Frontend**: User uploads video via multipart form
2. **API Videos**: Receives upload, stores in Bunny.net, queues processing
3. **Queue**: `video_upload` message with metadata
4. **Processor**: Validates, transcodes, generates thumbnails
5. **WebSocket**: Notifies subscribers of processing status
6. **Frontend**: Updates UI with real-time progress

### 2. Video View Flow

```
Frontend → API Videos → Queue → Processor → R2 Storage → WebSocket → Frontend
    │           │           │          │           │           │
    │           │           │          │           │           │
    ▼           ▼           ▼          ▼           ▼           ▼
Video Page → View API → Queue → Analytics → Watch History → Real-time → UI Update
```

**Analytics Collection:**
- View count increment
- Watch time tracking
- User engagement metrics
- Geographic distribution

### 3. Real-time Engagement Flow

```
Frontend → WebSocket Server → Durable Objects → KV Storage → Other Frontends
    │           │                 │              │              │
    │           │                 │              │              │
    ▼           ▼                 ▼              ▼              ▼
Like Button → WebSocket → Presence DO → KV Store → Broadcast → All Clients
```

**Real-time Features:**
- Like/dislike counts
- Comment notifications
- Live chat
- Presence indicators

## Authentication Integration

### OpenAuth Integration Pattern

All services use **OpenAuth** for authentication with consistent JWT token validation:

```typescript
// Shared authentication middleware
export async function validateJWT(token: string): Promise<AuthSubject> {
  const response = await fetch('https://auth.alummahnow.net/validate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) {
    throw new Error('Invalid authentication token');
  }
  
  return response.json();
}
```

### Token Flow:
1. **Frontend**: Redirects to OpenAuth for login
2. **OpenAuth**: Returns JWT token after authentication
3. **Frontend**: Stores token, includes in all API requests
4. **API Services**: Validate token via middleware
5. **WebSocket**: Validates token on connection

## Data Storage Integration

### R2 Storage Integration

**Shared Buckets:**
- `videos`: Video files and metadata
- `profiles`: User profile data
- `channels`: Channel information
- `playlists`: Playlist data
- `watch-history`: User viewing history

**Access Pattern:**
```typescript
// Consistent R2 access pattern across services
export class R2Repository<T> {
  constructor(
    private bucket: R2Bucket,
    private keyPrefix: string
  ) {}
  
  async get(id: string): Promise<T | null> {
    const object = await this.bucket.get(`${this.keyPrefix}/${id}`);
    return object ? await object.json<T>() : null;
  }
  
  async put(id: string, data: T): Promise<void> {
    await this.bucket.put(`${this.keyPrefix}/${id}`, JSON.stringify(data));
  }
}
```

### KV Storage Integration

**Presence Tracking:**
```typescript
// apps/websocket-server/src/presence.ts
export class PresenceManager {
  async setUserOnline(userId: string, connectionId: string): Promise<void> {
    await this.env.PRESENCE_KV.put(
      `user:${userId}:online`,
      JSON.stringify({
        connectionId,
        timestamp: Date.now(),
        status: 'online'
      }),
      { expirationTtl: 300 } // 5 minutes
    );
  }
}
```

## Error Handling Integration

### Standardized Error Format

```typescript
// Shared error response format
interface ApiError {
  success: false;
  error: string;
  code?: string;
  details?: any;
  timestamp: string;
}
```

### Error Propagation:
1. **Service Errors**: Logged and formatted as API responses
2. **Queue Failures**: Dead Letter Queue for retry
3. **WebSocket Errors**: Connection cleanup and client notification
4. **Frontend Errors**: User-friendly error messages with retry options

## Performance Integration

### Caching Strategy

**Multi-layer Caching:**
1. **Cloudflare CDN**: Edge caching for static assets
2. **KV Storage**: Fast access for frequently accessed data
3. **R2 Storage**: Persistent object storage
4. **Browser Cache**: Client-side caching for UI components

### Rate Limiting

**API Rate Limiting:**
```typescript
// Cloudflare Workers rate limiting
app.use('/api/*', async (c, next) => {
  const clientIP = c.req.header('CF-Connecting-IP');
  const rateLimit = await checkRateLimit(clientIP);
  
  if (rateLimit.exceeded) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  
  await next();
});
```

**WebSocket Rate Limiting:**
- 100 messages per minute per connection
- Connection limits per user
- Automatic disconnect for abuse

## Monitoring Integration

### Centralized Logging

**Log Format:**
```typescript
interface LogEntry {
  timestamp: string;
  service: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  userId?: string;
  requestId?: string;
  metadata?: any;
}
```

**Log Aggregation:**
- All services use structured logging
- Cloudflare Workers analytics for metrics
- Custom dashboards for business metrics
- Error tracking with context

### Health Check Integration

**Standard Health Endpoints:**
```typescript
// Consistent health check across all services
app.get('/health', async (c) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'api-videos',
    version: process.env.VERSION || '1.0.0',
    dependencies: {
      r2: await checkR2Health(),
      kv: await checkKVHealth(),
      queue: await checkQueueHealth()
    }
  };
  
  return c.json(health);
});
```

## Security Integration

### CORS Integration

**Consistent CORS Configuration:**
```typescript
const corsConfig = {
  origin: ['https://alummahnow.net', 'https://*.alummahnow.net'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 600,
  credentials: false
};
```

### Input Validation Integration

**Shared Validation Patterns:**
```typescript
// Using shared types for validation
import { VideoObject, User } from '@al-ummah/shared-types';
import { z } from 'zod';

export const VideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  tags: z.array(z.string()).max(10),
  isPublic: z.boolean()
});
```

## Deployment Integration

### CI/CD Pipeline Integration

**GitHub Actions Workflow:**
```yaml
# Integrated deployment pipeline
name: Deploy Al Ummah Now
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup pnpm
        uses: pnpm/action-setup@v2
      - name: Install dependencies
        run: pnpm install
      - name: Run tests
        run: pnpm test
      - name: Type check
        run: pnpm type-check

  deploy:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [web, api-videos, processor, websocket-server]
    steps:
      - name: Deploy ${{ matrix.service }}
        run: pnpm ${{ matrix.service }}:deploy
```

### Environment Integration

**Shared Environment Variables:**
- `CLOUDFLARE_API_TOKEN`: Deployment authentication
- `OPENAUTH_ISSUER`: Authentication provider
- `BUNNY_API_KEY`: Video streaming service

**Service-Specific Configuration:**
- Each service has environment-specific wrangler configs
- Shared secrets via Cloudflare Secrets Store
- Consistent naming conventions across environments

## Future Integration Points

### Planned Enhancements

1. **Analytics Service**: Dedicated analytics processing
2. **Notification Service**: Email/push notifications
3. **Search Service**: Advanced content search
4. **Moderation Service**: AI-powered content moderation

### Integration Patterns for Future Services

**Service Mesh Pattern:**
```typescript
// Future service integration
interface ServiceRegistry {
  registerService(name: string, endpoint: string): Promise<void>;
  discoverService(name: string): Promise<string[]>;
  healthCheck(service: string): Promise<HealthStatus>;
}
```

**Event-Driven Architecture:**
```typescript
// Future event bus integration
interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): Promise<void>;
  unsubscribe(eventType: string, handler: EventHandler): Promise<void>;
}
```

## Troubleshooting Integration Issues

### Common Integration Problems

1. **Authentication Failures**:
   - Check JWT token validity
   - Verify OpenAuth configuration
   - Ensure consistent token format

2. **Queue Processing Delays**:
   - Monitor queue depth
   - Check Dead Letter Queue
   - Verify batch processing configuration

3. **WebSocket Connection Issues**:
   - Validate Durable Objects configuration
   - Check KV storage connectivity
   - Verify authentication tokens

4. **R2 Storage Errors**:
   - Check bucket permissions
   - Verify CORS configuration
   - Monitor storage limits

### Debugging Tools

**Integration Testing:**
```bash
# Test API integration
curl -H "Authorization: Bearer $TOKEN" \
     https://videos.api.alummahnow.net/api/videos

# Test WebSocket connection
wscat -c "wss://ws.alummahnow.net?token=$TOKEN"

# Monitor queue processing
pnpm wrangler tail --filter al-ummah-now-processor
```

**Monitoring Dashboards:**
- Cloudflare Workers analytics
- Custom integration health dashboard
- Real-time WebSocket metrics
- Queue processing statistics

This integration architecture provides a comprehensive view of how Al Ummah Now's services interact, ensuring reliable communication, consistent data flows, and maintainable integration patterns.