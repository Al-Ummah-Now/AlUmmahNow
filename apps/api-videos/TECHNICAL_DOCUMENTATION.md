# Al-Ummah Now Videos API - Technical Documentation

> **🔗 Links**: [Roadmap](./ROADMAP.md) | [Project Board](https://github.com/users/meywd/projects/1/views/1) | [Live API](https://videos.api.alummahnow.net/)

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [API Endpoints](#api-endpoints)
3. [Authentication & Security](#authentication--security)
4. [Data Models](#data-models)
5. [Development Setup](#development-setup)
6. [Deployment](#deployment)
7. [Key Flows](#key-flows)
8. [Error Handling](#error-handling)
9. [Rate Limiting](#rate-limiting)
10. [Monitoring & Analytics](#monitoring--analytics)

## Architecture Overview

### Technology Stack

- **Runtime**: Cloudflare Workers (Edge Computing)
- **Framework**: Hono.js with Chanfana (OpenAPI 3.1)
- **Language**: TypeScript with Zod validation
- **Storage**: Cloudflare R2 (metadata), Bunny.net (video files)
- **Authentication**: OpenAuth (JWT tokens)
- **Documentation**: Auto-generated OpenAPI with Swagger UI
- **Queue**: Cloudflare Queues (analytics processing)

### System Architecture

#### High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        Web[Web Applications]
        Mobile[Mobile Apps]
        API_Client[API Clients]
    end
    
    subgraph "CDN & Edge Layer"
        CF[Cloudflare Edge Network]
        CDN[Bunny.net CDN]
    end
    
    subgraph "API Layer"
        Worker[Videos API Worker]
        Auth_MW[Auth Middleware]
        CORS_MW[CORS Middleware]
        Rate_MW[Rate Limiting]
    end
    
    subgraph "Authentication"
        OpenAuth[OpenAuth Service]
        JWT[JWT Validation]
    end
    
    subgraph "Storage Layer"
        R2[Cloudflare R2]
        Videos_Bucket[(Videos Metadata)]
        Profiles_Bucket[(User Profiles)]
        Channels_Bucket[(Channels)]
        Playlists_Bucket[(Playlists)]
        KV[KV Store - Auth Cache]
    end
    
    subgraph "Media Services"
        Bunny_API[Bunny.net API]
        Bunny_Storage[Video Storage]
        Bunny_Stream[Streaming Service]
        Thumb_Gen[Thumbnail Generation]
    end
    
    subgraph "Analytics & Processing"
        Queue[Analytics Queue]
        Processor[Event Processor]
        Metrics[Metrics Collection]
    end
    
    Web --> CF
    Mobile --> CF
    API_Client --> CF
    
    CF --> Worker
    Worker --> Auth_MW
    Auth_MW --> CORS_MW
    CORS_MW --> Rate_MW
    
    Worker --> JWT
    JWT --> OpenAuth
    
    Worker --> R2
    R2 --> Videos_Bucket
    R2 --> Profiles_Bucket
    R2 --> Channels_Bucket
    R2 --> Playlists_Bucket
    
    Worker --> KV
    Worker --> Queue
    Queue --> Processor
    Processor --> Metrics
    
    Worker --> Bunny_API
    Bunny_API --> Bunny_Storage
    Bunny_API --> Bunny_Stream
    Bunny_API --> Thumb_Gen
    
    CDN --> Bunny_Stream
    CDN --> Thumb_Gen
```

#### Infrastructure Architecture

```mermaid
graph TB
    subgraph "Global Edge Locations"
        Edge1[US East]
        Edge2[US West]
        Edge3[Europe]
        Edge4[Asia Pacific]
    end
    
    subgraph "Cloudflare Infrastructure"
        CF_DNS[DNS Resolution]
        CF_SSL[SSL Termination]
        CF_Cache[Edge Caching]
        CF_Workers[Workers Runtime]
    end
    
    subgraph "Core Services"
        API[Videos API Worker]
        R2_Global[R2 Global Storage]
        KV_Global[KV Global Store]
        Queue_Global[Queue System]
    end
    
    subgraph "External Services"
        OpenAuth_Service[OpenAuth Provider]
        Bunny_Global[Bunny.net Global CDN]
        Analytics_Ext[External Analytics]
    end
    
    Edge1 --> CF_DNS
    Edge2 --> CF_DNS
    Edge3 --> CF_DNS
    Edge4 --> CF_DNS
    
    CF_DNS --> CF_SSL
    CF_SSL --> CF_Cache
    CF_Cache --> CF_Workers
    CF_Workers --> API
    
    API --> R2_Global
    API --> KV_Global
    API --> Queue_Global
    API --> OpenAuth_Service
    API --> Bunny_Global
    
    Queue_Global --> Analytics_Ext
```

#### Service Integration Points

```mermaid
graph LR
    subgraph "Videos API Core"
        API[API Router]
        Auth[Auth Middleware]
        Endpoints[Endpoint Handlers]
    end
    
    subgraph "External Integrations"
        OpenAuth[OpenAuth Service]
        Bunny[Bunny.net API]
        R2[Cloudflare R2]
        Queue[CF Queue]
        KV[CF KV Store]
    end
    
    subgraph "Integration Patterns"
        JWT_Val[JWT Validation]
        Media_Ops[Media Operations]
        Data_Ops[Data Operations]
        Event_Ops[Event Operations]
        Cache_Ops[Cache Operations]
    end
    
    API --> Auth
    Auth --> Endpoints
    
    Auth --> JWT_Val
    JWT_Val --> OpenAuth
    
    Endpoints --> Media_Ops
    Media_Ops --> Bunny
    
    Endpoints --> Data_Ops
    Data_Ops --> R2
    
    Endpoints --> Event_Ops
    Event_Ops --> Queue
    
    Endpoints --> Cache_Ops
    Cache_Ops --> KV
```

### Core Principles

1. **Edge-First**: Deploy at Cloudflare's edge for low latency globally
2. **Type Safety**: Full TypeScript with Zod validation for all API contracts
3. **Privacy by Design**: Granular privacy controls for all content
4. **Scalable Storage**: Separate metadata (R2) from media files (Bunny.net)
5. **OpenAPI Native**: Auto-generated documentation with full authentication support

## API Endpoints

### Base URL
- **Production**: `https://videos.api.alummahnow.net`
- **Development**: `http://localhost:8686`

### Endpoint Categories

#### 🔓 Public Endpoints (No Authentication Required)
```
GET  /                          # OpenAPI Documentation (Swagger UI)
GET  /openapi.json             # OpenAPI 3.1 Schema
GET  /api/videos               # List public videos (with privacy filtering)
GET  /api/videos/:id           # Get video details (public only)
GET  /api/playlists            # List public playlists
GET  /api/playlists/:id        # Get playlist details (public only)
GET  /api/channels             # List channels
GET  /api/channels/:id         # Get channel details
GET  /api/profiles             # List profiles
GET  /api/profiles/:id         # Get profile details
```

#### 🔒 Authenticated Endpoints (JWT Required)
```
# Video Management
POST   /api/videos             # Create new video
PUT    /api/videos/:id         # Update video
DELETE /api/videos/:id         # Delete video

# User Interactions
POST   /api/videos/:id/likes   # Like video
DELETE /api/videos/:id/likes   # Remove like
POST   /api/videos/:id/dislikes # Dislike video
DELETE /api/videos/:id/dislikes # Remove dislike

# Comments
POST   /api/videos/:id/comments # Create comment
PUT    /api/comments/:id        # Update comment
DELETE /api/comments/:id        # Delete comment
POST   /api/comments/:id/likes  # Like comment
DELETE /api/comments/:id/likes  # Remove comment like

# Profile Management
PUT    /api/profiles/:id        # Update profile
DELETE /api/profiles/:id        # Delete profile

# Channel Management
POST   /api/channels            # Create channel
PUT    /api/channels/:id        # Update channel
DELETE /api/channels/:id        # Delete channel

# Playlist Management
POST   /api/playlists           # Create playlist
PUT    /api/playlists/:id       # Update playlist
DELETE /api/playlists/:id       # Delete playlist

# Authentication Test
GET    /auth-test               # Test JWT authentication
```

## Authentication & Security

### JWT Token Structure

The API uses JWT tokens provided by OpenAuth with the following claims:

```json
{
  "sub": "user-id-12345",           // Required: User ID
  "email": "user@example.com",      // Optional: User email
  "iat": 1640995200,               // Issued at timestamp
  "exp": 1641081600,               // Expiration timestamp
  "aud": "videos-api",             // Audience
  "iss": "https://auth.alummahnow.net" // Issuer
}
```

### Authentication Flow

1. **Client obtains JWT token** from OpenAuth service
2. **Include token in requests**: `Authorization: Bearer <jwt-token>`
3. **API validates token** and extracts user context
4. **User context** is automatically added to request headers

### Privacy Controls

- **Public Content**: Accessible without authentication
- **Private Content**: Only accessible to content owner
- **Privacy Filtering**: Public endpoints automatically filter private content

### Security Headers

All responses include security headers:
- `Access-Control-Allow-Origin`
- `Content-Security-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`

## Data Models

### Core Entities

#### Video
```typescript
{
  id: string;                    // Unique identifier
  title: string;                 // Video title
  description?: string;          // Video description
  thumbnailUrl?: string;         // Thumbnail image URL
  videoUrl?: string;             // Video file URL (Bunny.net)
  userId: string;                // Owner user ID
  channelId: string;             // Owner channel ID
  dateCreated: Date;             // Creation timestamp
  dateModified: Date;            // Last modification
  views: number;                 // View count
  width?: number;                // Video width
  height?: number;               // Video height
  availableResolutions: string[]; // Available quality options
  comments: Comment[];           // Nested comments
  likes: Like[];                 // Like records
  dislikes: Dislike[];           // Dislike records
  isPublic: boolean;             // Privacy setting
  isLive: boolean;               // Live stream flag
}
```

#### Channel
```typescript
{
  id: string;                    // Unique identifier
  userId: string;                // Owner user ID
  email: string;                 // Associated email
  name: string;                  // Channel name
  isMain: boolean;               // Primary channel flag
  avatarUrl?: string;            // Channel avatar
  coverUrl?: string;             // Channel cover image
  dateCreated: Date;             // Creation timestamp
  dateModified: Date;            // Last modification
  playlists: string[];           // Playlist IDs
  videos: string[];              // Video IDs
  subscribers: Subscription[];   // Subscriber records
  subscriptions: Subscription[]; // Channel subscriptions
  likes: Like[];                 // Channel likes
}
```

#### Comment
```typescript
{
  id: string;                    // Unique identifier
  userId: string;                // Commenter user ID
  channelId: string;             // Commenter channel ID
  videoId: string;               // Target video ID
  text: string;                  // Comment content
  dateCreated: Date;             // Creation timestamp
  dateModified?: Date;           // Last modification
  likes: Like[];                 // Comment likes
  dislikes: Dislike[];           // Comment dislikes
  isEdited: boolean;             // Edit flag
  isDeleted: boolean;            // Soft delete flag
  isPinned: boolean;             // Pinned by video owner
  replies: Comment[];            // Nested replies
}
```

### Storage Strategy

- **R2 Buckets**: Store JSON metadata for each entity type
- **Object Keys**: Use entity IDs as object keys
- **Relationships**: Store entity IDs to maintain relationships
- **Indexing**: Use pagination cursors for listing operations

## Development Setup

### Prerequisites

#### Required Software
- **Node.js**: v20.19.5+ (check with `node --version`)
- **npm**: v10.8.2+ (check with `npm --version`)
- **Git**: Latest version for repository management
- **VS Code**: Recommended editor with TypeScript support

#### Cloudflare Account Setup
1. Sign up for [Cloudflare Workers](https://workers.dev) (free tier sufficient)
2. Enable Workers and R2 in your Cloudflare dashboard
3. Note your account ID from the dashboard sidebar

#### External Service Accounts
- **Bunny.net**: Sign up for video streaming and CDN services
- **OpenAuth Provider**: Set up authentication service (or use existing SST setup)

### Quick Start Guide

#### 1. Repository Setup
```bash
# Clone the repository
git clone https://github.com/meywd/AlUmmahNowVideos.git
cd AlUmmahNowVideos

# Install dependencies (takes ~10-15 seconds)
npm install

# Verify TypeScript compilation
npx tsc --noEmit

# Validate deployment configuration
npx wrangler deploy --dry-run
```

#### 2. Environment Configuration

Create development environment file:
```bash
# .env.development (optional for local overrides)
BUNNY_STREAM_KEY=your_bunny_stream_key_here
BUNNY_STREAM_LIBRARY_ID=your_library_id_here
IMAGE_STORAGE_KEY=your_image_storage_key_here
```

#### 3. Cloudflare Authentication
```bash
# Login to Cloudflare (opens browser for authentication)
wrangler login

# Verify authentication
wrangler whoami
```

#### 4. Local Development
```bash
# Start development server (takes 10-15 seconds to start)
npm run dev
# or
wrangler dev

# Server will be available at http://127.0.0.1:8686
# API documentation at http://127.0.0.1:8686/
```

### Development Environment Details

#### Wrangler Configuration (`wrangler.jsonc`)

The project uses Cloudflare Workers with these bindings:

```json
{
  "name": "al-ummah-now-videos",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "kv_namespaces": [
    { "binding": "TUS_SESSIONS", "id": "preview_id", "preview_id": "dev_id" },
    { "binding": "RATE_LIMIT_KV", "id": "preview_id", "preview_id": "dev_id" }
  ],
  "r2_buckets": [
    { "binding": "videos", "bucket_name": "videos", "preview_bucket_name": "videos-preview" },
    { "binding": "profiles", "bucket_name": "profiles", "preview_bucket_name": "profiles-preview" },
    { "binding": "channels", "bucket_name": "channels", "preview_bucket_name": "channels-preview" },
    { "binding": "playlists", "bucket_name": "playlists", "preview_bucket_name": "playlists-preview" }
  ],
  "queues": {
    "producers": [
      { "binding": "queue", "queue": "al-ummah-now-videos" }
    ]
  }
}
```

#### TypeScript Configuration

The project uses strict TypeScript settings:
- **Strict Mode**: Enabled for maximum type safety
- **Target**: ES2022 for modern JavaScript features
- **Module**: ESNext for optimal bundling
- **Cloudflare Types**: Auto-generated from `worker-configuration.d.ts`

### Testing Strategy

#### Manual Testing Scenarios

**1. API Documentation Validation**
```bash
# Start development server
npm run dev

# Verify Swagger UI loads
curl -s http://127.0.0.1:8686/ | grep -q "swagger" && echo "✓ Swagger UI loads"

# Verify OpenAPI schema is valid JSON
curl -s http://127.0.0.1:8686/openapi.json | jq . > /dev/null && echo "✓ OpenAPI schema valid"
```

**2. Authentication Testing**
```bash
# Test public endpoints (should work without authentication)
curl -s "http://127.0.0.1:8686/api/videos" | jq .

# Test auth-required endpoints (should return 401 without token)
curl -s "http://127.0.0.1:8686/auth-test" | jq .

# Test with invalid token (should return 401)
curl -s -H "Authorization: Bearer invalid-token" "http://127.0.0.1:8686/auth-test" | jq .
```

**3. CORS Testing**
```bash
# Test preflight request
curl -X OPTIONS \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  http://127.0.0.1:8686/api/videos

# Verify CORS headers are present
curl -s -H "Origin: http://localhost:3000" "http://127.0.0.1:8686/api/videos" -v
```

**4. Error Handling Validation**
```bash
# Test malformed JSON
curl -X POST "http://127.0.0.1:8686/api/videos" \
  -H "Content-Type: application/json" \
  -d "invalid-json" | jq .

# Test missing required fields
curl -X POST "http://127.0.0.1:8686/api/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d "{}" | jq .
```

#### Integration Testing

**External Service Health Checks**
```typescript
// Test script for external services
async function healthCheck() {
  const tests = [
    {
      name: 'Bunny.net API',
      test: () => fetch('https://api.bunny.net/library', {
        headers: { 'AccessKey': process.env.BUNNY_STREAM_KEY }
      })
    },
    {
      name: 'OpenAuth Service',
      test: () => fetch('https://your-openauth-issuer.com/.well-known/openid-configuration')
    },
    {
      name: 'Cloudflare R2',
      test: () => /* R2 connectivity test */
    }
  ];

  for (const test of tests) {
    try {
      await test.test();
      console.log(`✓ ${test.name}: OK`);
    } catch (error) {
      console.log(`✗ ${test.name}: ${error.message}`);
    }
  }
}
```

### Debugging Guide

#### Development Server Debugging

**Console Logging**
```typescript
// Add debug logging to your endpoints
console.log('Request received:', {
  method: c.req.method,
  url: c.req.url,
  headers: Object.fromEntries(c.req.headers),
  userContext: c.get('userContext')
});
```

**Request Inspection**
```bash
# Enable verbose logging in Wrangler
wrangler dev --log-level debug

# Monitor requests in real-time
tail -f ~/.wrangler/logs/wrangler.log
```

#### Common Development Issues

**1. TypeScript Compilation Errors**
```bash
# Check for type errors
npx tsc --noEmit

# Common fixes:
# - Update worker-configuration.d.ts for new Cloudflare types
# - Ensure all imports use correct paths
# - Verify Zod schema definitions match TypeScript interfaces
```

**2. Authentication Issues**
```bash
# Debug JWT token parsing
echo "your-jwt-token" | base64 -d | jq .

# Test token validation
curl -X GET "http://127.0.0.1:8686/auth-test" \
  -H "Authorization: Bearer your-jwt-token" \
  -v
```

**3. CORS Problems**
```bash
# Check CORS configuration in browser dev tools
# Verify Origin header matches allowed origins
# Confirm preflight requests return correct headers
```

#### Performance Debugging

**Response Time Analysis**
```typescript
// Add timing middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header('X-Response-Time', `${duration}ms`);
});
```

**Memory Usage Monitoring**
```typescript
// Monitor memory usage
const memUsage = process.memoryUsage();
console.log('Memory usage:', {
  rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
  heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
});
```

### Contribution Workflow

#### Before Making Changes

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Run Pre-commit Checks**
   ```bash
   # Type checking
   npx tsc --noEmit
   
   # Deployment validation
   npx wrangler deploy --dry-run
   ```

3. **Test Changes Locally**
   ```bash
   # Start development server
   npm run dev
   
   # Run manual test scenarios
   # Test affected endpoints
   # Verify authentication still works
   ```

#### Code Quality Standards

**TypeScript Best Practices**
- Use strict typing for all function parameters and return values
- Prefer interfaces over types for object shapes
- Use Zod schemas for runtime validation
- Avoid `any` type - use `unknown` if necessary

**API Design Guidelines**
- Follow RESTful conventions
- Use consistent error response format
- Include comprehensive OpenAPI documentation
- Implement proper HTTP status codes

**Security Checklist**
- All authenticated endpoints use `addAuthToSchema` helper
- User context properly extracted from JWT
- Private data filtered based on ownership
- Input validation using Zod schemas

#### Testing Before Submission

**Manual Testing Checklist**
- [ ] Swagger UI loads correctly
- [ ] Authentication flow works end-to-end
- [ ] Public endpoints accessible without auth
- [ ] Protected endpoints require valid JWT
- [ ] CORS headers present for browser requests
- [ ] Error responses follow standard format
- [ ] Rate limiting functions correctly (if modified)

**Integration Testing**
- [ ] External service connections work
- [ ] Database operations succeed
- [ ] Queue events are properly sent
- [ ] Webhook endpoints respond correctly

### Deployment Guide

#### Production Deployment

```bash
# Deploy to production
npm run deploy
# or
wrangler deploy

# Verify deployment
curl -s https://videos.api.alummahnow.net/api/videos | jq .
```

#### Environment Management

```bash
# Deploy to specific environment
wrangler deploy --env staging
wrangler deploy --env production

# Set production secrets
wrangler secret put bunny-stream-key --env production
wrangler secret put image_storage_key --env production
```

#### Post-Deployment Verification

```bash
# Health check script
curl -s https://videos.api.alummahnow.net/api/videos
curl -s https://videos.api.alummahnow.net/openapi.json | jq . > /dev/null
curl -s https://videos.api.alummahnow.net/ | grep -q "swagger"
```

### Advanced Development Topics

#### Adding New Endpoints

1. **Create endpoint file** in `src/endpoints/[category]/`
2. **Use endpoint template**:
   ```typescript
   import { OpenAPIRoute } from "chanfana";
   import { z } from "zod";
   import { addAuthToSchema } from "../../lib/openapi-auth";

   export class NewEndpoint extends OpenAPIRoute {
     schema = addAuthToSchema({
       tags: ["Category"],
       summary: "Endpoint description",
       request: {
         params: z.object({
           id: z.string().openapi({ example: "123" })
         })
       },
       responses: {
         200: {
           description: "Success response",
           content: {
             "application/json": {
               schema: z.object({
                 success: z.boolean(),
                 data: z.any()
               })
             }
           }
         }
       }
     });

     async handle(c: Context) {
       const userContext = c.get('userContext');
       // Implementation
     }
   }
   ```

3. **Register in `src/index.ts`**
4. **Test thoroughly**

#### Database Schema Changes

When modifying data models:
1. Update TypeScript interfaces in `src/lib/types.ts`
2. Update Zod schemas for validation
3. Consider backward compatibility
4. Test with existing data
5. Document migration strategy if needed

#### Performance Optimization

- **Caching Strategy**: Use KV store for frequently accessed data
- **Lazy Loading**: Load related data only when needed
- **Batch Operations**: Combine multiple R2 operations
- **Edge Optimization**: Minimize compute at edge locations

## Deployment

### Cloudflare Workers Deployment

```bash
# Deploy to production
npm run deploy

# Deploy with environment
wrangler deploy --env production
```

### Environment Variables

Set the following secrets in Cloudflare dashboard:
- `bunny-stream-key`: Bunny.net API key
- `bunny_stream_library_id`: Bunny.net library ID
- `al-ummah-now-images-key`: Image storage key

### Production URLs

- **API Base**: `https://videos.api.alummahnow.net`
- **Documentation**: `https://videos.api.alummahnow.net/`
- **OpenAPI Schema**: `https://videos.api.alummahnow.net/openapi.json`

## Key Flows

### Video Upload Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Auth
    participant R2
    participant Bunny
    participant Queue
    
    Note over Client,Queue: Complete Video Upload Flow
    
    Client->>API: POST /api/videos (metadata)
    API->>Auth: Validate JWT token
    
    alt Valid JWT
        Auth-->>API: User context extracted
        API->>API: Validate video metadata
        
        alt Valid metadata
            API->>R2: Store initial video metadata
            API->>Bunny: Create video entry
            
            alt Bunny success
                Bunny-->>API: Upload URL + video ID
                API->>Queue: Send "video_created" event
                API-->>Client: 201 Created with upload URL
                
                Note over Client,Bunny: Direct upload to Bunny.net
                Client->>Bunny: Upload video file to URL
                Bunny-->>Client: Upload progress/completion
                
                Note over Bunny,API: Webhook notification
                Bunny->>API: Webhook: encoding complete
                API->>R2: Update metadata (URLs, resolutions)
                API->>Queue: Send "video_processed" event
                
            else Bunny failure
                API-->>Client: 503 Service Unavailable
                API->>Queue: Send "bunny_error" event
            end
            
        else Invalid metadata
            API-->>Client: 400 Bad Request (validation errors)
        end
        
    else Invalid JWT
        Auth-->>API: Authentication error
        API-->>Client: 401 Unauthorized
    end
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Middleware
    participant OpenAuth
    participant KV
    participant R2

    Note over Client,R2: Complete Authentication Flow

    Client->>API: Request with Authorization header
    API->>Middleware: Process request
    Middleware->>Middleware: Extract JWT from header
    
    alt JWT present
        Middleware->>KV: Check token cache
        
        alt Token cached and valid
            KV-->>Middleware: Cached user context
        else Token not cached or expired
            Middleware->>OpenAuth: Validate JWT signature
            
            alt Valid JWT
                OpenAuth-->>Middleware: Token validation success
                Middleware->>Middleware: Extract user claims
                Middleware->>KV: Cache user context (TTL: 1h)
            else Invalid JWT
                OpenAuth-->>Middleware: Token validation failed
                Middleware-->>API: 401 Unauthorized
                API-->>Client: 401 Unauthorized
            end
        end
        
        Middleware->>API: Attach user context to request
        API->>R2: Query with user filtering applied
        R2-->>API: User-specific filtered results
        API-->>Client: 200 OK with personalized data
        
    else No JWT
        Middleware->>API: Continue without user context
        API->>R2: Query public data only
        R2-->>API: Public content only
        API-->>Client: 200 OK with public data
    end
```

### Privacy Filtering Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Filter
    participant R2

    Note over Client,R2: Privacy-Aware Data Filtering

    Client->>API: GET /api/videos (request)
    API->>API: Check authentication status
    
    alt Authenticated user
        API->>Filter: Apply user-specific filtering
        Note over Filter: Include user's private content + public content
        Filter->>R2: Query with user ID context
        R2-->>Filter: All accessible videos for user
        Filter->>Filter: Apply additional privacy rules
        Filter-->>API: Filtered results (public + user's private)
        
    else Unauthenticated request
        API->>Filter: Apply public-only filtering
        Note over Filter: Only public content
        Filter->>R2: Query public content only
        R2-->>Filter: Public videos only
        Filter-->>API: Public results only
    end
    
    API->>API: Apply pagination and sorting
    API-->>Client: JSON response with filtered data
```

### Error Handling Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Service
    participant Logger
    participant Queue

    Note over Client,Queue: Comprehensive Error Handling

    Client->>API: Request with potential issues
    API->>Service: Process request
    
    alt External Service Error
        Service-->>API: Service unavailable/timeout
        API->>Logger: Log error details
        API->>Queue: Send error event for monitoring
        API-->>Client: 503 Service Unavailable + retry info
        
    else Validation Error
        API->>API: Input validation fails
        API-->>Client: 400 Bad Request + detailed errors
        
    else Authentication Error
        API->>API: JWT validation fails
        API-->>Client: 401 Unauthorized + auth instructions
        
    else Authorization Error
        API->>API: Insufficient permissions
        API-->>Client: 403 Forbidden + permission details
        
    else Resource Not Found
        API->>Service: Resource query returns empty
        API-->>Client: 404 Not Found + suggestions
        
    else Rate Limit Exceeded
        API->>API: Rate limit check fails
        API-->>Client: 429 Too Many Requests + retry-after
        
    else Internal Error
        Service-->>API: Unexpected error
        API->>Logger: Log full error stack
        API->>Queue: Send critical error alert
        API-->>Client: 500 Internal Server Error (generic)
    end
```

### Rate Limiting Implementation Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant RateLimit
    participant KV
    participant Response

    Note over Client,Response: Rate Limiting Strategy

    Client->>API: Incoming request
    API->>RateLimit: Check rate limits
    RateLimit->>RateLimit: Determine limit key (IP/User)
    
    RateLimit->>KV: Get current request count
    
    alt Within limits
        KV-->>RateLimit: Current count < limit
        RateLimit->>KV: Increment request count
        RateLimit->>Response: Add rate limit headers
        Response-->>API: Continue processing
        API-->>Client: Normal response + rate limit headers
        
    else Rate limit exceeded
        KV-->>RateLimit: Current count >= limit
        RateLimit->>Response: Prepare 429 response
        Response-->>API: Rate limit exceeded
        API-->>Client: 429 Too Many Requests + retry-after header
    end
    
    Note over RateLimit: Rate limit headers included:
    Note over RateLimit: X-RateLimit-Limit: 1000
    Note over RateLimit: X-RateLimit-Remaining: 995
    Note over RateLimit: X-RateLimit-Reset: 1640995260
```

## Error Handling

### Standard Error Format

All API errors follow a consistent JSON structure:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error description",
  "details": {
    "field": "specific_field_name",
    "code": "VALIDATION_CODE",
    "value": "invalid_value_provided"
  },
  "timestamp": "2024-12-19T10:30:00Z",
  "requestId": "req_12345abcdef",
  "retryable": true
}
```

### HTTP Status Codes & Error Categories

#### 4xx Client Errors

| Status | Error Code | Description | Retryable | Common Causes |
|--------|------------|-------------|-----------|---------------|
| 400 | `VALIDATION_ERROR` | Request validation failed | No | Invalid input data, missing required fields |
| 400 | `MALFORMED_REQUEST` | Request format is invalid | No | Invalid JSON, wrong Content-Type |
| 401 | `UNAUTHORIZED` | Authentication required | No | Missing JWT token |
| 401 | `INVALID_TOKEN` | JWT token is invalid | No | Expired/malformed/invalid signature |
| 401 | `TOKEN_EXPIRED` | JWT token has expired | Yes | Token TTL exceeded |
| 403 | `FORBIDDEN` | Insufficient permissions | No | User lacks required permissions |
| 403 | `RESOURCE_ACCESS_DENIED` | Cannot access specific resource | No | Private content, ownership mismatch |
| 404 | `NOT_FOUND` | Resource does not exist | No | Invalid ID, deleted resource |
| 409 | `CONFLICT` | Resource already exists | No | Duplicate creation attempt |
| 409 | `RESOURCE_CONFLICT` | Resource state conflict | Yes | Concurrent modification |
| 422 | `BUSINESS_RULE_VIOLATION` | Business logic constraint | No | Upload limits, content policy |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests | Yes | Rate limiting triggered |

#### 5xx Server Errors

| Status | Error Code | Description | Retryable | Recovery Strategy |
|--------|------------|-------------|-----------|-------------------|
| 500 | `INTERNAL_ERROR` | Unexpected server error | Yes | Automatic retry with backoff |
| 502 | `EXTERNAL_SERVICE_ERROR` | External service failure | Yes | Retry with exponential backoff |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable | Yes | Check service status, retry later |
| 504 | `EXTERNAL_SERVICE_TIMEOUT` | External service timeout | Yes | Retry with increased timeout |

### Detailed Error Scenarios

#### Authentication Errors

**Missing Authorization Header**
```json
{
  "success": false,
  "error": "UNAUTHORIZED",
  "message": "Authorization header is required for this endpoint",
  "details": {
    "header": "Authorization",
    "format": "Bearer <jwt-token>",
    "example": "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
  },
  "retryable": false
}
```

**Invalid JWT Token**
```json
{
  "success": false,
  "error": "INVALID_TOKEN",
  "message": "JWT token is invalid or malformed",
  "details": {
    "reason": "signature_verification_failed",
    "issuer_expected": "https://auth.alummahnow.net",
    "audience_expected": "videos-api"
  },
  "retryable": false
}
```

**Expired JWT Token**
```json
{
  "success": false,
  "error": "TOKEN_EXPIRED",
  "message": "JWT token has expired",
  "details": {
    "expired_at": "2024-12-19T09:30:00Z",
    "current_time": "2024-12-19T10:30:00Z",
    "refresh_url": "https://auth.alummahnow.net/refresh"
  },
  "retryable": true
}
```

#### Validation Errors

**Multiple Field Validation**
```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "fields": [
      {
        "field": "title",
        "code": "REQUIRED",
        "message": "Title is required"
      },
      {
        "field": "description",
        "code": "TOO_LONG",
        "message": "Description must be less than 5000 characters",
        "max_length": 5000,
        "actual_length": 5234
      },
      {
        "field": "isPublic",
        "code": "INVALID_TYPE",
        "message": "isPublic must be a boolean",
        "expected_type": "boolean",
        "actual_type": "string"
      }
    ]
  },
  "retryable": false
}
```

#### External Service Errors

**Bunny.net Service Error**
```json
{
  "success": false,
  "error": "EXTERNAL_SERVICE_ERROR",
  "message": "Video service is temporarily unavailable",
  "details": {
    "service": "bunny_net",
    "service_error": "upstream_timeout",
    "retry_after": 300,
    "status_url": "https://status.bunny.net"
  },
  "retryable": true
}
```

**R2 Storage Error**
```json
{
  "success": false,
  "error": "EXTERNAL_SERVICE_ERROR",
  "message": "Storage service encountered an error",
  "details": {
    "service": "cloudflare_r2",
    "operation": "put_object",
    "bucket": "videos",
    "retry_after": 60
  },
  "retryable": true
}
```

### Error Recovery Strategies

#### Client-Side Recovery

**Exponential Backoff for Retryable Errors**
```javascript
async function apiCallWithRetry(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (!error.retryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }
}
```

**Rate Limit Handling**
```javascript
async function handleRateLimit(response) {
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return fetch(response.url, response.request);
  }
  return response;
}
```

**Authentication Error Recovery**
```javascript
async function handleAuthError(error) {
  if (error.error === 'TOKEN_EXPIRED') {
    // Attempt to refresh token
    const newToken = await refreshAuthToken();
    if (newToken) {
      // Retry original request with new token
      return retryWithNewToken(newToken);
    }
  }
  
  // Redirect to login if refresh fails
  redirectToLogin();
}
```

#### Server-Side Error Handling

**Circuit Breaker Pattern for External Services**
```typescript
class ExternalServiceCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute

  async call<T>(serviceCall: () => Promise<T>): Promise<T> {
    if (this.isCircuitOpen()) {
      throw new Error('EXTERNAL_SERVICE_ERROR: Circuit breaker is open');
    }

    try {
      const result = await serviceCall();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isCircuitOpen(): boolean {
    return this.failures >= this.threshold && 
           (Date.now() - this.lastFailureTime) < this.timeout;
  }

  private onSuccess() {
    this.failures = 0;
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
  }
}
```

### Troubleshooting Guide

#### Common Issues and Solutions

**1. Authentication Problems**

*Problem*: `INVALID_TOKEN` errors
*Solutions*:
- Verify JWT token format: `Bearer <token>`
- Check token expiration time
- Validate token issuer and audience claims
- Ensure token was issued by correct OpenAuth service

*Problem*: `FORBIDDEN` errors for owned resources
*Solutions*:
- Verify JWT `sub` claim matches resource owner
- Check user permissions in OpenAuth system
- Ensure resource hasn't been transferred to another user

**2. Upload Issues**

*Problem*: Video upload fails with `EXTERNAL_SERVICE_ERROR`
*Solutions*:
- Check Bunny.net service status
- Verify upload URL hasn't expired (24-hour TTL)
- Ensure file size is within limits (5GB max)
- Check network connectivity to Bunny.net

*Problem*: Metadata creation succeeds but video upload fails
*Solutions*:
- Use the provided upload URL immediately
- Implement upload progress monitoring
- Have fallback to re-request upload URL
- Clean up orphaned metadata records

**3. Performance Issues**

*Problem*: Slow API responses
*Diagnostics*:
- Check response headers for processing time
- Monitor external service latency
- Verify edge cache hit rates
- Review query complexity

*Solutions*:
- Implement client-side caching
- Use pagination for large result sets
- Optimize query parameters
- Consider using WebSocket for real-time features

### Error Monitoring and Alerting

#### Metrics to Monitor

- **Error Rate**: Percentage of requests resulting in errors
- **Error Distribution**: Breakdown by error type and endpoint
- **Recovery Rate**: Percentage of retryable errors that succeed on retry
- **External Service Health**: Uptime and response times of dependencies

#### Alert Thresholds

- **Critical**: Error rate > 5% for 5 minutes
- **Warning**: External service timeout > 10% for 10 minutes
- **Info**: New error types or unusual error patterns

#### Error Response Headers

All error responses include additional debugging headers:

```
X-Request-ID: req_12345abcdef67890
X-Error-Code: VALIDATION_ERROR
X-Retry-After: 300
X-Service-Version: v0.0.1
X-Edge-Location: IAD
```

## Rate Limiting

### Rate Limiting Strategy

The API implements a multi-tier rate limiting strategy using Cloudflare's edge infrastructure and KV storage for distributed rate limiting across all edge locations.

#### Rate Limit Tiers

| Tier | Scope | Limit | Window | Key | Use Case |
|------|-------|--------|--------|-----|----------|
| **Global IP** | Per IP Address | 100 req/min | 1 minute | `ip:{ip_address}` | DDoS protection |
| **User API** | Per Authenticated User | 1,000 req/min | 1 minute | `user:{user_id}` | Normal API usage |
| **Upload** | Per User | 10 uploads/hour | 1 hour | `upload:{user_id}` | Resource protection |
| **Search** | Per IP/User | 60 req/min | 1 minute | `search:{ip_or_user}` | Search abuse prevention |
| **Auth** | Per IP | 20 req/min | 1 minute | `auth:{ip_address}` | Auth endpoint protection |

#### Implementation Architecture

```mermaid
graph TB
    subgraph "Rate Limiting Flow"
        Request[Incoming Request]
        Middleware[Rate Limit Middleware]
        KeyGen[Rate Limit Key Generation]
        KVCheck[KV Storage Check]
        Decision{Within Limits?}
        Allow[Allow Request]
        Block[Block Request]
        Headers[Add Rate Limit Headers]
    end
    
    Request --> Middleware
    Middleware --> KeyGen
    KeyGen --> KVCheck
    KVCheck --> Decision
    
    Decision -->|Yes| Allow
    Decision -->|No| Block
    
    Allow --> Headers
    Block --> Headers
    
    Headers --> Response[Send Response]
```

### Rate Limit Headers

All responses include rate limiting information:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 995
X-RateLimit-Reset: 1640995260
X-RateLimit-Retry-After: 60
```

### Rate Limit Key Generation

```typescript
interface RateLimitKey {
  tier: 'global' | 'user' | 'upload' | 'search' | 'auth';
  identifier: string;
  window: number;
}

function generateRateLimitKey(
  request: Request, 
  tier: string, 
  userContext?: UserContext
): string {
  const timestamp = Math.floor(Date.now() / (60 * 1000)); // 1-minute windows
  
  switch (tier) {
    case 'global':
      return `global:${getClientIP(request)}:${timestamp}`;
    
    case 'user':
      return userContext 
        ? `user:${userContext.userId}:${timestamp}`
        : `ip:${getClientIP(request)}:${timestamp}`;
    
    case 'upload':
      return `upload:${userContext?.userId}:${Math.floor(timestamp / 60)}`; // 1-hour window
    
    case 'search':
      const identifier = userContext?.userId || getClientIP(request);
      return `search:${identifier}:${timestamp}`;
    
    case 'auth':
      return `auth:${getClientIP(request)}:${timestamp}`;
    
    default:
      throw new Error(`Unknown rate limit tier: ${tier}`);
  }
}
```

### Dynamic Rate Limiting

#### Adaptive Limits Based on User Behavior

```typescript
interface AdaptiveRateLimit {
  baseLimit: number;
  trustScore: number; // 0.0 to 1.0
  recentViolations: number;
  accountAge: number; // days
}

function calculateAdaptiveLimit(user: UserContext): number {
  const baseLimit = 1000; // requests per minute
  
  // Trust score factors
  const trustMultiplier = Math.max(0.1, user.trustScore);
  const ageBonus = Math.min(2.0, 1 + (user.accountAge / 365)); // Max 2x for 1+ year accounts
  const violationPenalty = Math.max(0.1, 1 - (user.recentViolations * 0.1));
  
  return Math.floor(baseLimit * trustMultiplier * ageBonus * violationPenalty);
}
```

#### Burst Handling

The API implements a token bucket algorithm for handling traffic bursts:

```typescript
interface TokenBucket {
  capacity: number;      // Maximum tokens
  tokens: number;        // Current tokens
  refillRate: number;    // Tokens per second
  lastRefill: number;    // Timestamp of last refill
}

function consumeTokens(bucket: TokenBucket, requested: number): boolean {
  const now = Date.now();
  const timePassed = (now - bucket.lastRefill) / 1000;
  
  // Refill tokens based on time passed
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + (timePassed * bucket.refillRate)
  );
  bucket.lastRefill = now;
  
  if (bucket.tokens >= requested) {
    bucket.tokens -= requested;
    return true;
  }
  
  return false;
}
```

### Rate Limit Bypass Mechanisms

#### API Key Tier System

| Tier | Rate Limit | Features | Use Case |
|------|------------|----------|----------|
| **Free** | 1,000/min | Basic API access | Individual developers |
| **Pro** | 10,000/min | Higher limits + analytics | Professional use |
| **Enterprise** | 100,000/min | Custom limits + SLA | High-volume integrations |

#### Whitelisting

```typescript
const RATE_LIMIT_WHITELIST = [
  'trusted-partner-api.example.com',
  'internal-service.alummahnow.net',
  'monitoring.internal'
];

function isWhitelisted(request: Request): boolean {
  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('User-Agent') || '';
  
  return RATE_LIMIT_WHITELIST.some(pattern => 
    clientIP.includes(pattern) || userAgent.includes(pattern)
  );
}
```

### Rate Limit Monitoring and Analytics

#### Metrics Collection

```typescript
interface RateLimitMetrics {
  timestamp: number;
  tier: string;
  identifier: string;
  requests: number;
  blocked: number;
  limit: number;
  endpoint: string;
  responseTime: number;
}

function collectRateLimitMetrics(
  key: string,
  result: RateLimitResult,
  endpoint: string,
  responseTime: number
): void {
  const metrics: RateLimitMetrics = {
    timestamp: Date.now(),
    tier: key.split(':')[0],
    identifier: key.split(':')[1],
    requests: result.totalRequests,
    blocked: result.blocked ? 1 : 0,
    limit: result.limit,
    endpoint,
    responseTime
  };
  
  // Send to analytics queue
  sendToAnalyticsQueue('rate_limit_metrics', metrics);
}
```

#### Alert Thresholds

- **High Usage Alert**: User reaches 90% of rate limit
- **Abuse Detection**: User hits rate limit multiple times in 1 hour
- **System Alert**: Global rate limit blocks > 5% of traffic

### Client-Side Rate Limit Handling

#### JavaScript SDK Example

```javascript
class APIClient {
  constructor(baseURL, authToken) {
    this.baseURL = baseURL;
    this.authToken = authToken;
    this.rateLimitInfo = {};
  }

  async makeRequest(endpoint, options = {}) {
    // Check if we should wait due to rate limiting
    if (this.shouldWaitForRateLimit(endpoint)) {
      await this.waitForRateLimit(endpoint);
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      // Update rate limit info from headers
      this.updateRateLimitInfo(endpoint, response.headers);

      if (response.status === 429) {
        return this.handleRateLimit(response, endpoint, options);
      }

      return response;
    } catch (error) {
      throw error;
    }
  }

  updateRateLimitInfo(endpoint, headers) {
    this.rateLimitInfo[endpoint] = {
      limit: parseInt(headers.get('X-RateLimit-Limit')),
      remaining: parseInt(headers.get('X-RateLimit-Remaining')),
      reset: parseInt(headers.get('X-RateLimit-Reset')),
      retryAfter: parseInt(headers.get('X-RateLimit-Retry-After'))
    };
  }

  shouldWaitForRateLimit(endpoint) {
    const info = this.rateLimitInfo[endpoint];
    if (!info) return false;

    const now = Math.floor(Date.now() / 1000);
    return info.remaining === 0 && now < info.reset;
  }

  async waitForRateLimit(endpoint) {
    const info = this.rateLimitInfo[endpoint];
    const now = Math.floor(Date.now() / 1000);
    const waitTime = (info.reset - now) * 1000;
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  async handleRateLimit(response, endpoint, originalOptions) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    const waitTime = parseInt(retryAfter) * 1000;

    await new Promise(resolve => setTimeout(resolve, waitTime));
    return this.makeRequest(endpoint, originalOptions);
  }
}
```

### Rate Limiting Best Practices

#### For API Consumers

1. **Implement Exponential Backoff**: Start with short delays and increase exponentially
2. **Cache Responses**: Reduce API calls by caching frequently accessed data
3. **Batch Operations**: Combine multiple operations into single requests when possible
4. **Monitor Rate Limit Headers**: Track usage and adjust request patterns
5. **Use Webhooks**: For real-time updates instead of polling

#### For API Providers

1. **Fair Usage**: Implement per-user limits to prevent abuse
2. **Graceful Degradation**: Return useful error messages with retry guidance
3. **Multiple Tiers**: Offer different rate limits for different use cases
4. **Monitoring**: Track rate limit metrics and adjust limits based on usage patterns
5. **Documentation**: Clearly document rate limits and best practices

## Monitoring & Analytics

### Metrics Collected

- **Performance**: Response times, error rates
- **Usage**: Endpoint hit counts, user activity
- **Business**: Video views, engagement metrics
- **Security**: Authentication failures, suspicious activity

### Queue-Based Analytics

Events are queued for processing:
- Video views and engagement
- User interactions
- System performance metrics
- Error tracking

### Observability

- **Cloudflare Analytics**: Built-in performance monitoring
- **Custom Metrics**: Business-specific analytics
- **Error Tracking**: Automatic error collection
- **Health Checks**: System availability monitoring

---

## Additional Resources

- **[Authentication Guide](./AUTHENTICATION.md)**: For API users
- **[Developer Auth Guide](./DEVELOPER_AUTH_GUIDE.md)**: For API developers
- **[Roadmap](./ROADMAP.md)**: Feature development timeline
- **[Project Board](https://github.com/users/meywd/projects/1/views/1)**: Current development status

**Last Updated**: December 2024  
**API Version**: v0.0.1