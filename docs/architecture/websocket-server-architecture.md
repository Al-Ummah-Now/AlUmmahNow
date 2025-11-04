# WebSocket Server Architecture

## Overview

The **websocket-server** application is a real-time WebSocket server built on Cloudflare Durable Objects. It provides live communication capabilities for the Al Ummah Now platform, including channel subscriptions, presence tracking, and real-time notifications with JWT authentication and rate limiting.

## Technology Stack

### Core Framework
- **Cloudflare Durable Objects** - Strongly consistent serverless compute
- **WebSocket API** - Real-time bidirectional communication
- **TypeScript** - Type-safe development
- **Cloudflare Workers** - Execution environment

### Storage & Integration
- **Cloudflare KV** - Low-latency key-value storage for presence
- **JWT Authentication** - OpenAuth integration
- **Rate Limiting** - Message throttling and abuse prevention
- **Broadcasting** - Multi-client message distribution

## Architecture Patterns

### 1. Durable Object Architecture
```
src/
├── WebSocketServer.ts       # Main Durable Object class
├── handlers/                # Message handlers
│   ├── ConnectionHandler.ts # Connection management
│   ├── SubscriptionHandler.ts # Channel subscriptions
│   ├── MessageHandler.ts    # Message processing
│   ├── PresenceHandler.ts   # User presence tracking
│   └── BroadcastHandler.ts  # Message broadcasting
├── middleware/              # Processing middleware
│   ├── auth.ts              # JWT authentication
│   ├── rateLimit.ts         # Rate limiting
│   ├── validation.ts        # Message validation
│   └── errorHandler.ts      # Error handling
├── repositories/            # Data access layer
│   ├── PresenceRepository.ts # Presence data management
│   └── types.ts             # Type definitions
└── types/                   # Type system
    ├── messages.ts          # WebSocket message types
    ├── events.ts            # Event type definitions
    ├── auth.ts              # Authentication types
    └── presence.ts          # Presence tracking types
```

### 2. Channel Subscription Architecture
```typescript
// Supported channel types
type ChannelType = 
  | 'user'                  // User-specific notifications
  | 'video'                 // Video-specific updates
  | 'channel'               // Channel updates
  | 'live'                  // Live stream events
  | 'system'                // System notifications
  | 'moderation'            // Moderation events
  | 'analytics'             // Analytics updates;

// Subscription structure
interface Subscription {
  userId: string;
  channelType: ChannelType;
  channelId: string;
  filters?: Record<string, any>;
  permissions: string[];
}
```

### 3. Message Flow Architecture
```
Client WebSocket → Authentication → Rate Limit → Validation → Handler → Broadcast → Other Clients
                      ↓
                  Error Handler ← Rate Limit Exceeded ← Validation Failed ← Auth Failed
```

## Key Architectural Components

### 1. Durable Object Implementation
- **State Management**: Consistent state across connections
- **Connection Pooling**: Efficient connection management
- **Message Routing**: Intelligent message distribution
- **Lifecycle Management**: Connection and subscription lifecycle

### 2. Authentication System
- **JWT Validation**: Token verification and user context
- **Permission Checking**: Channel access permissions
- **Session Management**: User session tracking
- **Security Enforcement**: Secure WebSocket connections

### 3. Presence Tracking
- **User Status**: Online/offline status tracking
- **Channel Presence**: User presence per channel
- **Activity Monitoring**: User activity tracking
- **KV Storage**: Low-latency presence data

### 4. Rate Limiting & Abuse Prevention
- **Message Throttling**: 100 messages/minute per connection
- **Connection Limits**: Maximum connections per user
- **Abuse Detection**: Suspicious activity monitoring
- **Graceful Degradation**: Service protection under load

## Directory Structure Deep Dive

### `/src/WebSocketServer.ts` - Main Durable Object
- **Connection Management**: WebSocket connection lifecycle
- **Message Routing**: Incoming message distribution
- **Broadcast Logic**: Outgoing message distribution
- **State Management**: Durable Object state handling

### `/src/handlers/` - Message Handlers
- **ConnectionHandler**: Connection establishment and teardown
- **SubscriptionHandler**: Channel subscription management
- **MessageHandler**: Message processing and validation
- **PresenceHandler**: User presence tracking
- **BroadcastHandler**: Message broadcasting logic

### `/src/middleware/` - Processing Pipeline
- **Authentication**: JWT token validation
- **Rate Limiting**: Message throttling enforcement
- **Validation**: Message schema validation
- **Error Handling**: Consistent error responses

### `/src/repositories/` - Data Access
- **PresenceRepository**: Presence data operations
- **Type Definitions**: TypeScript interfaces
- **KV Operations**: Cloudflare KV interactions

## WebSocket Message Protocol

### 1. Message Types
```typescript
// Client → Server messages
interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'presence';
  payload: any;
  timestamp: number;
  messageId: string;
}

// Server → Client messages
interface ServerMessage {
  type: 'subscription' | 'message' | 'presence' | 'error' | 'system';
  payload: any;
  timestamp: number;
  messageId: string;
}
```

### 2. Subscription Protocol
```typescript
// Subscribe to channel
{
  type: 'subscribe',
  payload: {
    channelType: 'video',
    channelId: 'video-123',
    filters: { events: ['comment', 'like'] }
  }
}

// Subscription confirmation
{
  type: 'subscription',
  payload: {
    status: 'confirmed',
    subscriptionId: 'sub-456',
    channelType: 'video',
    channelId: 'video-123'
  }
}
```

### 3. Message Broadcasting
```typescript
// Broadcast message
{
  type: 'message',
  payload: {
    channelType: 'video',
    channelId: 'video-123',
    event: 'comment',
    data: { commentId: 'c-789', userId: 'u-123' }
  }
}
```

## Presence Tracking Architecture

### 1. Presence Data Model
```typescript
interface PresenceData {
  userId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: number;
  currentChannel?: string;
  metadata: Record<string, any>;
}

interface ChannelPresence {
  channelId: string;
  users: string[];
  count: number;
  lastUpdated: number;
}
```

### 2. KV Storage Strategy
- **Namespace**: `al-ummah-now-analytics-kv`
- **Key Pattern**: `presence:{userId}` and `channel:{channelId}`
- **TTL**: Automatic expiration of presence data
- **Consistency**: Strong consistency guarantees

### 3. Presence Updates
- **Join Events**: User joins channel
- **Leave Events**: User leaves channel
- **Heartbeat**: Regular presence updates
- **Cleanup**: Automatic stale data removal

## Authentication & Security

### 1. JWT Authentication Flow
```typescript
// WebSocket connection with JWT
const ws = new WebSocket('wss://ws.alummahnow.net', [], {
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIs...'
  }
});

// Server-side validation
class AuthMiddleware {
  async validateToken(token: string): Promise<UserContext> {
    const payload = await verifyJWT(token);
    return {
      userId: payload.sub,
      permissions: payload.permissions,
      sessionId: payload.sid
    };
  }
}
```

### 2. Permission System
- **Channel Access**: User can only access authorized channels
- **Action Permissions**: Specific action permissions
- **Role-Based Access**: Admin, moderator, user roles
- **Dynamic Permissions**: Context-aware permission checks

### 3. Security Measures
- **WSS Protocol**: Secure WebSocket connections only
- **Origin Validation**: Allowed origin checking
- **Message Validation**: Input sanitization
- **Rate Limiting**: Abuse prevention mechanisms

## Rate Limiting Architecture

### 1. Rate Limiting Strategy
```typescript
interface RateLimitConfig {
  messagesPerMinute: 100;    // Messages per connection
  connectionsPerUser: 5;     // Max connections per user
  burstLimit: 10;            // Short-term burst allowance
  windowSize: 60;            // Time window in seconds
}
```

### 2. Implementation
- **Token Bucket**: Rate limiting algorithm
- **Per-Connection Limits**: Individual connection throttling
- **Global Limits**: Platform-wide protection
- **Graceful Handling**: Rate limit exceeded responses

### 3. Abuse Detection
- **Pattern Recognition**: Unusual usage patterns
- **Automatic Blocking**: Temporary connection blocking
- **Manual Review**: Suspicious activity flagging
- **Reporting**: Abuse incident reporting

## Performance Optimizations

### 1. Durable Object Optimizations
- **Connection Pooling**: Efficient connection reuse
- **Message Batching**: Batch message processing
- **Memory Management**: Optimized memory usage
- **State Synchronization**: Efficient state updates

### 2. KV Storage Optimizations
- **Low-Latency Access**: Optimized KV operations
- **Caching Strategy**: Frequently accessed data
- **Batch Operations**: Bulk KV operations
- **TTL Management**: Automatic data cleanup

### 3. Network Optimizations
- **Message Compression**: Payload size reduction
- **Binary Protocol**: Efficient message encoding
- **Connection Reuse**: Persistent connections
- **Geographic Distribution**: Edge deployment

## Monitoring and Observability

### 1. Connection Metrics
- **Active Connections**: Real-time connection count
- **Connection Duration**: Connection lifecycle metrics
- **Message Throughput**: Messages per second
- **Error Rates**: Connection and message errors

### 2. Performance Metrics
- **Latency**: Message processing time
- **Memory Usage**: Durable Object memory consumption
- **CPU Usage**: Processing resource utilization
- **Network I/O**: Data transfer metrics

### 3. Business Metrics
- **User Engagement**: Real-time user activity
- **Channel Activity**: Channel-specific metrics
- **Feature Usage**: WebSocket feature utilization
- **System Health**: Overall platform health

## Deployment Architecture

### 1. Cloudflare Workers Configuration
```toml
# wrangler.toml
name = "al-ummah-websocket-server"
compatibility_date = "2024-01-01"
main = "src/index.ts"

[[durable_objects.bindings]]
name = "WEBSOCKET_SERVER"
class_name = "WebSocketServer"

[[kv_namespaces]]
binding = "PRESENCE_KV"
id = "al-ummah-now-analytics-kv"
preview_id = "al-ummah-now-analytics-kv-preview"

[vars]
ENVIRONMENT = "production"
JWT_SECRET = "your-jwt-secret"
RATE_LIMIT_PER_MINUTE = "100"
```

### 2. Durable Object Configuration
- **Class Definition**: WebSocketServer Durable Object
- **Instance Management**: Automatic instance scaling
- **State Persistence**: Automatic state persistence
- **Migration Support**: Zero-downtime updates

### 3. Environment Configuration
- **Development**: Local testing with Wrangler
- **Staging**: Pre-production validation
- **Production**: Live real-time communication

## Integration Points

### 1. Internal Services
- **Web Application**: WebSocket client connections
- **API Videos**: Event source for real-time updates
- **Processor**: Event processing triggers
- **Shared Types**: Common type definitions

### 2. External Services
- **OpenAuth**: JWT authentication service
- **Cloudflare KV**: Presence data storage
- **Cloudflare Durable Objects**: Compute platform
- **Monitoring Services**: Observability platforms

### 3. Data Flows
- **User Activities**: Real-time user interactions
- **Content Updates**: Live content notifications
- **System Events**: Platform status updates
- **Presence Data**: User availability information

## Testing Architecture

### 1. Unit Testing
- **Handler Testing**: Individual handler testing
- **Middleware Testing**: Pipeline component testing
- **Repository Testing**: Data access testing
- **Utility Testing**: Helper function testing

### 2. Integration Testing
- **WebSocket Testing**: End-to-end connection testing
- **Authentication Testing**: JWT validation testing
- **Rate Limiting Testing**: Throttling mechanism testing
- **Presence Testing**: Presence tracking testing

### 3. Load Testing
- **Connection Load**: High connection count testing
- **Message Load**: High message volume testing
- **Stress Testing**: System limit testing
- **Performance Testing**: Latency and throughput testing

## Key Architectural Decisions

### 1. Cloudflare Durable Objects
**Decision**: Use Durable Objects for WebSocket server implementation.

**Rationale**:
- Strong consistency guarantees
- Low-latency communication
- Automatic scaling and reliability
- Integrated with Cloudflare ecosystem

### 2. JWT Authentication
**Decision**: Use JWT for WebSocket authentication.

**Rationale**:
- Stateless authentication
- Integration with existing auth system
- Secure token validation
- Scalable authentication mechanism

### 3. KV for Presence
**Decision**: Use Cloudflare KV for presence tracking.

**Rationale**:
- Low-latency key-value access
- Global distribution
- Automatic scaling
- Cost-effective storage

### 4. Rate Limiting
**Decision**: Implement comprehensive rate limiting.

**Rationale**:
- Abuse prevention
- Service protection
- Fair resource allocation
- Operational stability

## Future Architecture Considerations

### 1. Scalability Enhancements
- **Multi-Region Deployment**: Geographic distribution
- **Load Balancing**: Intelligent connection routing
- **Caching Layers**: Advanced caching strategies
- **Performance Optimization**: Enhanced throughput

### 2. Feature Expansions
- **Advanced Presence**: Rich presence information
- **Message Persistence**: Message history storage
- **File Transfer**: Real-time file sharing
- **Video Streaming**: Live video integration

### 3. Technical Improvements
- **Protocol Optimization**: Custom binary protocols
- **Security Enhancement**: Advanced security features
- **Monitoring Enhancement**: Advanced observability
- **Testing Automation**: Comprehensive test coverage

## Conclusion

The WebSocket Server architecture provides a robust, scalable, and real-time communication system for the Al Ummah Now platform. The combination of Cloudflare Durable Objects, WebSocket API, and comprehensive security measures creates a reliable real-time infrastructure that can handle the platform's communication needs while maintaining high performance and security standards.

The architecture prioritizes real-time performance through low-latency connections and efficient message routing, while ensuring operational excellence through comprehensive monitoring, security best practices, and automated deployment processes. The presence tracking and subscription system enables rich real-time features that enhance user engagement and platform interactivity.