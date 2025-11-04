# API Videos Architecture

## Overview

The **api-videos** application is a Hono v4-based REST API backend deployed on Cloudflare Workers. It serves as the primary data layer for the Al Ummah Now platform, providing 50+ endpoints for video management, user operations, and content administration with OpenAPI 3.1 documentation.

## Technology Stack

### Core Framework
- **Hono v4** - Fast web framework for Cloudflare Workers
- **Cloudflare Workers** - Serverless execution environment
- **TypeScript** - Strict type safety and development experience
- **Zod** - Runtime type validation and schema definitions

### API Documentation
- **chanfana** - OpenAPI 3.1 integration for Hono
- **Swagger UI** - Interactive API documentation
- **OpenAPI Schema** - Auto-generated API specifications

### Storage & Integration
- **Cloudflare R2** - Object storage for all data
- **Bunny CDN** - Video streaming and image storage
- **OpenAuth** - JWT authentication service
- **Repository Pattern** - Data access abstraction

## Architecture Patterns

### 1. Repository Pattern Architecture
```
src/repositories/
├── base/                    # Base repository interfaces
│   ├── BaseRepository.ts   # Core repository interface
│   └── types.ts            # Common repository types
├── video/                  # Video data management
│   ├── VideoRepository.ts  # Video CRUD operations
│   └── types.ts            # Video-specific types
├── channel/                # Channel data management
│   ├── ChannelRepository.ts
│   └── types.ts
├── user/                   # User data management
│   ├── UserRepository.ts
│   └── types.ts
└── analytics/              # Analytics data management
    ├── AnalyticsRepository.ts
    └── types.ts
```

### 2. Endpoint Organization Architecture
```
src/endpoints/
├── video/                  # Video-related endpoints
│   ├── videoCreate.ts      # POST /videos
│   ├── videoGet.ts         # GET /videos/{id}
│   ├── videoList.ts        # GET /videos
│   ├── videoUpdate.ts      # PUT /videos/{id}
│   └── videoDelete.ts      # DELETE /videos/{id}
├── channel/                # Channel management
│   ├── channelCreate.ts
│   ├── channelGet.ts
│   ├── channelList.ts
│   └── channelUpdate.ts
├── user/                   # User operations
│   ├── userGet.ts
│   ├── userUpdate.ts
│   └── userPreferences.ts
├── comment/                # Comment system
│   ├── commentCreate.ts
│   ├── commentList.ts
│   └── commentModerate.ts
├── analytics/              # Analytics endpoints
│   ├── videoViews.ts
│   ├── userEngagement.ts
│   └── channelStats.ts
└── admin/                  # Administrative functions
    ├── contentModeration.ts
    └── systemHealth.ts
```

### 3. Middleware Architecture
```
src/middleware/
├── auth.ts                 # JWT authentication
├── cors.ts                 # CORS configuration
├── rateLimit.ts            # Rate limiting
├── validation.ts           # Request validation
└── errorHandler.ts         # Error handling
```

## Key Architectural Components

### 1. Authentication & Authorization
- **JWT Middleware**: Automatic token validation
- **OpenAuth Integration**: External authentication service
- **Role-Based Access**: User permissions and admin access
- **Token Refresh**: Automatic token renewal

### 2. Data Access Layer
- **Repository Pattern**: Consistent data access interface
- **R2 Storage**: Object-based data persistence
- **Type Safety**: End-to-end TypeScript integration
- **Caching Strategy**: Edge caching for performance

### 3. API Documentation System
- **OpenAPI 3.1**: Comprehensive API specification
- **Swagger UI**: Interactive documentation at root URL
- **Schema Validation**: Automatic request/response validation
- **Type Generation**: TypeScript types from OpenAPI schemas

### 4. Error Handling Architecture
```typescript
// Consistent error response structure
{
  "error": {
    "code": "VIDEO_NOT_FOUND",
    "message": "Video with ID 'xyz' not found",
    "details": {
      "videoId": "xyz",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  }
}
```

## Directory Structure Deep Dive

### `/src/repositories/` - Data Access Layer
- **Base Repository**: Common CRUD operations and interfaces
- **Entity Repositories**: Specific implementations for each data type
- **Type Definitions**: TypeScript interfaces for data structures
- **Query Builders**: Complex query construction helpers

### `/src/endpoints/` - API Endpoints
- **RESTful Design**: Standard HTTP methods and status codes
- **Validation**: Zod schemas for request/response validation
- **Authentication**: Protected endpoints with JWT middleware
- **Documentation**: OpenAPI decorators for auto-documentation

### `/src/lib/` - Utility Libraries
- **OpenAuth Client**: Authentication service integration
- **Bunny CDN**: Video streaming and image storage
- **Validation Schemas**: Zod schema definitions
- **Helper Functions**: Common utility functions

### `/src/middleware/` - Request Processing
- **Auth Middleware**: JWT token validation and user context
- **CORS Middleware**: Cross-origin request handling
- **Rate Limiting**: API abuse prevention
- **Error Handling**: Consistent error responses

## Data Flow Architecture

### 1. Request Processing Pipeline
```
HTTP Request → CORS → Rate Limit → Auth → Validation → Endpoint → Repository → R2 Storage
                ↓
            Error Handler ← Exception ← Business Logic ← Data Processing ← Response
```

### 2. Authentication Flow
```
Client Request → JWT Validation → User Context → Permission Check → Endpoint Execution
                ↓
            401 Unauthorized ← Token Invalid ← Missing Token ← Auth Failure
```

### 3. Data Access Flow
```
Endpoint → Repository → R2 Object → Data Processing → Response Validation → HTTP Response
          ↓
      Error Handling ← R2 Error ← Data Error ← Validation Error
```

## Performance Optimizations

### 1. Cloudflare Workers Optimizations
- **Edge Computing**: Global distribution for low latency
- **Cold Start Optimization**: Minimal initialization overhead
- **Memory Efficiency**: Optimized for Workers runtime limits
- **Concurrent Processing**: Parallel request handling

### 2. Storage Optimizations
- **R2 Performance**: Optimized object storage patterns
- **Caching Strategy**: Intelligent caching headers
- **Data Compression**: Reduced payload sizes
- **Batch Operations**: Efficient bulk operations

### 3. API Optimizations
- **Pagination**: Efficient data retrieval for large datasets
- **Field Selection**: Selective data retrieval
- **Compression**: Gzip compression for responses
- **Connection Pooling**: Efficient resource utilization

## Security Architecture

### 1. Authentication Security
- **JWT Validation**: Cryptographic token verification
- **Token Expiration**: Automatic token lifecycle management
- **Secure Transmission**: HTTPS-only communication
- **Replay Attack Prevention**: Token uniqueness and timing

### 2. Authorization Security
- **Role-Based Access Control**: Granular permission system
- **Resource Ownership**: User can only access their resources
- **Admin Privileges**: Elevated access for administrators
- **Permission Inheritance**: Hierarchical permission structure

### 3. Data Security
- **Input Validation**: Comprehensive request validation
- **SQL Injection Prevention**: Parameterized queries (R2)
- **XSS Prevention**: Output sanitization
- **Data Encryption**: Encrypted storage for sensitive data

### 4. API Security
- **Rate Limiting**: Request throttling per user/IP
- **CORS Configuration**: Controlled cross-origin access
- **Security Headers**: OWASP recommended headers
- **Audit Logging**: Comprehensive access logging

## Deployment Architecture

### 1. Cloudflare Workers Configuration
```toml
# wrangler.toml
name = "al-ummah-api-videos"
compatibility_date = "2024-01-01"
main = "src/index.ts"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "al-ummah-now-data"

[vars]
ENVIRONMENT = "production"
OPENAUTH_URL = "https://auth.alummahnow.net"
```

### 2. Environment Configuration
- **Development**: Local development with Wrangler
- **Staging**: Pre-production testing environment
- **Production**: Live deployment with full monitoring

### 3. CI/CD Integration
- **Automated Testing**: GitHub Actions test suite
- **Deployment Pipeline**: Automated deployment on merge
- **Rollback Strategy**: Quick rollback capabilities
- **Health Checks**: Post-deployment validation

## Monitoring and Observability

### 1. Performance Monitoring
- **Response Times**: Endpoint performance tracking
- **Error Rates**: Error frequency and patterns
- **Throughput**: Request volume and capacity
- **Resource Usage**: Workers resource consumption

### 2. Business Metrics
- **API Usage**: Endpoint usage statistics
- **User Activity**: Active user tracking
- **Content Engagement**: Video and channel metrics
- **System Health**: Overall platform health

### 3. Security Monitoring
- **Authentication Events**: Login/logout tracking
- **Access Patterns**: Unusual access detection
- **Rate Limiting**: Abuse detection and prevention
- **Security Incidents**: Automated threat detection

## API Design Principles

### 1. RESTful Design
- **Resource-Based URLs**: Clear resource identification
- **HTTP Methods**: Proper use of GET, POST, PUT, DELETE
- **Status Codes**: Appropriate HTTP status codes
- **Consistent Patterns**: Uniform API design

### 2. Versioning Strategy
- **URL Versioning**: `/v1/` prefix for versioning
- **Backward Compatibility**: Maintaining older versions
- **Deprecation Policy**: Clear deprecation timeline
- **Migration Path**: Smooth version transitions

### 3. Documentation Standards
- **OpenAPI 3.1**: Comprehensive API specification
- **Interactive Docs**: Swagger UI for exploration
- **Examples**: Request/response examples
- **Error Documentation**: Detailed error information

## Key Architectural Decisions

### 1. Hono v4 Framework
**Decision**: Use Hono v4 as the web framework.

**Rationale**:
- Optimized for Cloudflare Workers
- Excellent TypeScript support
- Built-in middleware system
- Performance-focused design

### 2. Repository Pattern
**Decision**: Implement repository pattern for data access.

**Rationale**:
- Consistent data access interface
- Testability through dependency injection
- Separation of concerns
- Easy storage backend changes

### 3. R2 Object Storage
**Decision**: Use Cloudflare R2 as primary storage.

**Rationale**:
- Serverless scaling
- Cost-effective for object storage
- Integrated with Cloudflare ecosystem
- No database management overhead

### 4. OpenAPI Integration
**Decision**: Use chanfana for OpenAPI 3.1 integration.

**Rationale**:
- Automatic API documentation
- Type safety from schemas
- Client SDK generation
- Standardized API design

## Integration Points

### 1. External Services
- **OpenAuth**: Authentication and authorization
- **Bunny CDN**: Video streaming and image delivery
- **Cloudflare R2**: Primary data storage
- **Cloudflare Workers**: Execution environment

### 2. Internal Services
- **Web Application**: Frontend API consumer
- **Processor**: Queue-based event processing
- **WebSocket Server**: Real-time notifications
- **Shared Types**: Common TypeScript definitions

### 3. Data Flows
- **User Data**: Authentication and profile management
- **Content Data**: Video and channel management
- **Analytics Data**: Usage tracking and metrics
- **System Data**: Health and monitoring information

## Future Architecture Considerations

### 1. Scalability Enhancements
- **Microservices**: Potential service decomposition
- **Event Sourcing**: Event-driven architecture patterns
- **CQRS**: Command Query Responsibility Segregation
- **Distributed Caching**: Advanced caching strategies

### 2. Feature Expansions
- **GraphQL**: Alternative API interface
- **Real-time APIs**: WebSocket integration
- **Advanced Search**: Full-text search capabilities
- **Machine Learning**: AI-powered features

### 3. Technical Improvements
- **Performance Optimization**: Advanced caching and optimization
- **Security Enhancements**: Advanced security features
- **Monitoring Improvements**: Enhanced observability
- **Testing Automation**: Comprehensive test coverage

## Conclusion

The API Videos architecture provides a robust, scalable, and maintainable foundation for the Al Ummah Now platform's backend needs. The combination of Hono v4, Cloudflare Workers, and modern API design principles creates an efficient serverless API that can handle the platform's growth while maintaining high performance and security standards.

The architecture prioritizes developer experience through comprehensive documentation, type safety, and consistent patterns, while ensuring operational excellence through monitoring, security best practices, and automated deployment processes.