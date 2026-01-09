# Video Upload Architecture

## Executive Summary

Al Ummah Now's video upload system implements a modern, serverless architecture using:
- **TUS Protocol** for resumable uploads
- **Signed URLs** for secure direct-to-CDN uploads
- **R2 Storage** for metadata persistence
- **Cloudflare Workers** for API endpoints
- **Bunny.net** for video streaming and encoding

This architecture prioritizes reliability, security, and scalability while minimizing operational complexity.

## System Context

```mermaid
graph TB
    subgraph "Users"
        U[User Browser]
        M[Mobile App]
    end

    subgraph "Al Ummah Now Platform"
        API[API Service<br/>Cloudflare Workers]
        WEB[Web App<br/>Next.js on Workers]
        WS[WebSocket Server<br/>Durable Objects]
        Q[Queue Processor<br/>Workers]
    end

    subgraph "External Services"
        AUTH[OpenAuth<br/>JWT Provider]
        BUNNY[Bunny.net<br/>Video CDN]
        R2[Cloudflare R2<br/>Object Storage]
        KV[Cloudflare KV<br/>Cache/Indexes]
    end

    U --> WEB
    M --> API
    WEB --> API
    API --> AUTH
    API --> R2
    API --> KV
    API --> BUNNY
    U --> BUNNY
    M --> BUNNY
    Q --> R2
    WS --> KV
    API --> Q
```

## Upload Flow Architecture

### High-Level Upload Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web App
    participant A as API
    participant R as R2 Storage
    participant B as Bunny.net
    participant Q as Queue

    U->>W: Select video file
    W->>W: Validate file locally
    U->>W: Enter metadata
    W->>A: Request upload authorization
    Note over A: Authenticate user<br/>Check rate limits<br/>Generate TUS signature
    A->>R: Store initial metadata
    A->>Q: Queue upload started event
    A-->>W: Return TUS config
    W->>B: Upload via TUS protocol
    Note over W,B: Direct upload<br/>Automatic resume<br/>Progress tracking
    B-->>W: Upload complete
    W->>A: Notify completion
    A->>R: Update metadata
    A->>Q: Queue processing event
    A-->>W: Confirm success
    W->>U: Show success
```

### Detailed Component Interactions

```mermaid
graph LR
    subgraph "Client Layer"
        UI[Upload UI]
        TUS[TUS Client]
        AUTH_C[Auth Context]
    end

    subgraph "API Layer"
        INIT[/upload/initiate]
        COMP[/upload/complete]
        STAT[/upload/status]
        MW[Auth Middleware]
        RL[Rate Limiter]
    end

    subgraph "Storage Layer"
        R2_V[R2: videos]
        R2_P[R2: profiles]
        KV_RL[KV: rate limits]
        KV_C[KV: cache]
    end

    subgraph "CDN Layer"
        TUS_E[TUS Endpoint]
        ENCODE[Encoding Pipeline]
        STREAM[Streaming CDN]
    end

    UI --> AUTH_C
    UI --> TUS
    AUTH_C --> MW
    TUS --> TUS_E

    INIT --> MW
    INIT --> RL
    RL --> KV_RL
    INIT --> R2_V

    COMP --> MW
    COMP --> R2_V

    STAT --> MW
    STAT --> R2_V
    STAT --> TUS_E

    TUS_E --> ENCODE
    ENCODE --> STREAM
```

## Data Flow

### Upload Initiation Data Flow

```mermaid
flowchart TD
    A[User Request] --> B{Authenticated?}
    B -->|No| C[Return 401]
    B -->|Yes| D[Check Rate Limits]
    D --> E{Within Limits?}
    E -->|No| F[Return 429]
    E -->|Yes| G[Validate Metadata]
    G --> H{Valid?}
    H -->|No| I[Return 400]
    H -->|Yes| J[Create Video in Bunny]
    J --> K[Generate TUS Signature]
    K --> L[Store in R2]
    L --> M[Queue Event]
    M --> N[Return TUS Config]
```

### TUS Upload Protocol Flow

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Uploading: Start Upload
    Uploading --> Paused: Pause
    Uploading --> Failed: Error
    Uploading --> Complete: 100%
    Paused --> Uploading: Resume
    Failed --> Uploading: Retry
    Complete --> Processing: Notify API
    Processing --> Ready: Encoding Done
    Processing --> Error: Encoding Failed
    Error --> [*]
    Ready --> [*]
```

## Security Architecture

### Authentication & Authorization Flow

```mermaid
graph TD
    subgraph "Client"
        C1[JWT Token]
        C2[Request Headers]
    end

    subgraph "API Gateway"
        G1[Auth Middleware]
        G2[Token Validation]
        G3[User Context]
    end

    subgraph "Business Logic"
        B1[Check Ownership]
        B2[Apply Quotas]
        B3[Generate Signature]
    end

    subgraph "External Auth"
        E1[OpenAuth Service]
        E2[Public Keys]
    end

    C1 --> C2
    C2 --> G1
    G1 --> G2
    G2 --> E1
    E1 --> E2
    G2 --> G3
    G3 --> B1
    B1 --> B2
    B2 --> B3
```

### Signed URL Security Model

```mermaid
graph LR
    subgraph "Server Side"
        SK[Secret Key]
        SIG[Signature Generator]
        EXP[Expiration Time]
    end

    subgraph "Client Side"
        URL[Signed URL]
        HDR[Auth Headers]
    end

    subgraph "CDN Validation"
        VAL[Signature Validator]
        CHK[Expiry Check]
        ACC[Accept/Reject]
    end

    SK --> SIG
    EXP --> SIG
    SIG --> URL
    SIG --> HDR
    URL --> VAL
    HDR --> VAL
    VAL --> CHK
    CHK --> ACC
```

## Storage Architecture

### R2 Bucket Organization

```mermaid
graph TD
    subgraph "R2 Buckets"
        V[videos/]
        V --> V1[abc123.json]
        V --> V2[def456.json]

        P[profiles/]
        P --> P1[user123.json]
        P --> P2[user456.json]

        C[channels/]
        C --> C1[channel1.json]
        C --> C2[channel2.json]

        PL[playlists/]
        PL --> PL1[playlist1.json]
        PL --> PL2[playlist2.json]
    end

    subgraph "KV Namespaces"
        KV1[rate-limits]
        KV2[user-indexes]
        KV3[cache]
    end
```

### Video Metadata Structure

```json
{
  "id": "uuid-v4",
  "title": "Video Title",
  "titleLocalized": {
    "en": "English Title",
    "ar": "العنوان بالعربية"
  },
  "description": "Description",
  "descriptionLocalized": {
    "en": "English description",
    "ar": "الوصف بالعربية"
  },
  "uploadMetadata": {
    "fileSize": 125000000,
    "mimeType": "video/mp4",
    "initiatedAt": "2025-11-20T10:00:00Z",
    "completedAt": "2025-11-20T10:15:00Z"
  },
  "processingMetadata": {
    "bunnyVideoId": "xyz789",
    "bunnyLibraryId": 12345,
    "encodingStatus": "complete",
    "availableResolutions": ["240p", "360p", "720p", "1080p"]
  },
  "engagement": {
    "views": 0,
    "likes": [],
    "dislikes": [],
    "comments": []
  },
  "permissions": {
    "isPublic": true,
    "allowComments": true,
    "allowDownload": false
  },
  "timestamps": {
    "createdAt": "2025-11-20T10:00:00Z",
    "updatedAt": "2025-11-20T10:15:00Z",
    "publishedAt": "2025-11-20T11:00:00Z"
  }
}
```

## Rate Limiting Architecture

### Rate Limit Enforcement

```mermaid
flowchart LR
    subgraph "Request"
        R[User Request]
        UID[User ID]
    end

    subgraph "Rate Limiter"
        T[Tier Detection]
        W[Window Check]
        C[Counter Update]
    end

    subgraph "KV Storage"
        K1[minute:user123]
        K2[hour:user123]
        K3[day:user123]
        K4[concurrent:user123]
    end

    subgraph "Response"
        A[Allow]
        D[Deny + Retry-After]
    end

    R --> UID
    UID --> T
    T --> W
    W --> K1
    W --> K2
    W --> K3
    W --> K4
    W --> C
    C --> A
    C --> D
```

## Error Handling & Recovery

### Upload Failure Recovery Flow

```mermaid
stateDiagram-v2
    [*] --> UploadStarted
    UploadStarted --> ChunkUpload
    ChunkUpload --> ChunkFailed: Network Error
    ChunkFailed --> RetryChunk: Auto Retry
    RetryChunk --> ChunkUpload: Backoff
    RetryChunk --> ManualRetry: Max Retries
    ManualRetry --> ResumeUpload: User Action
    ResumeUpload --> ChunkUpload
    ChunkUpload --> NextChunk: Success
    NextChunk --> ChunkUpload: More Chunks
    NextChunk --> UploadComplete: Last Chunk
    UploadComplete --> [*]
```

## Performance Optimization

### Caching Strategy

```mermaid
graph TD
    subgraph "Cache Layers"
        L1[Browser Cache<br/>5 min]
        L2[CDN Edge Cache<br/>1 hour]
        L3[KV Cache<br/>5 min]
        L4[R2 Storage<br/>Persistent]
    end

    REQ[Request] --> L1
    L1 -->|Miss| L2
    L2 -->|Miss| L3
    L3 -->|Miss| L4
    L4 --> L3
    L3 --> L2
    L2 --> L1
    L1 --> RES[Response]
```

## Monitoring & Observability

### Key Metrics

```mermaid
graph LR
    subgraph "Upload Metrics"
        M1[Upload Initiation Rate]
        M2[Upload Success Rate]
        M3[Average Upload Time]
        M4[Resume Count]
    end

    subgraph "Performance Metrics"
        P1[API Latency]
        P2[TUS Throughput]
        P3[Encoding Queue Depth]
        P4[Error Rate]
    end

    subgraph "Business Metrics"
        B1[Videos per User]
        B2[Storage Growth]
        B3[Bandwidth Usage]
        B4[Cost per Upload]
    end
```

## Deployment Architecture

### Multi-Environment Setup

```mermaid
graph TB
    subgraph "Development"
        DEV_API[api-dev.workers.dev]
        DEV_R2[videos-preview]
        DEV_KV[kv-preview]
    end

    subgraph "Staging"
        STG_API[api-staging.alummahnow.net]
        STG_R2[videos-staging]
        STG_KV[kv-staging]
    end

    subgraph "Production"
        PRD_API[api.alummahnow.net]
        PRD_R2[videos]
        PRD_KV[kv-production]
    end

    subgraph "Shared CDN"
        BUNNY[Bunny.net]
    end

    DEV_API --> BUNNY
    STG_API --> BUNNY
    PRD_API --> BUNNY
```

## Scalability Considerations

### Load Distribution

```mermaid
graph LR
    subgraph "Load Balancer"
        LB[Cloudflare]
    end

    subgraph "Edge Locations"
        E1[US-East]
        E2[US-West]
        E3[EU-West]
        E4[Asia-Pacific]
    end

    subgraph "Services"
        S1[API Workers]
        S2[R2 Storage]
        S3[KV Store]
    end

    LB --> E1
    LB --> E2
    LB --> E3
    LB --> E4

    E1 --> S1
    E2 --> S1
    E3 --> S1
    E4 --> S1

    S1 --> S2
    S1 --> S3
```

## Cost Model

### Upload Cost Breakdown

| Component | Unit Cost | Typical Usage | Monthly Cost |
|-----------|-----------|---------------|--------------|
| R2 Storage | $0.015/GB | 1TB | $15 |
| R2 Writes | $0.36/million | 10,000 uploads | $0.04 |
| R2 Reads | Free (10M) | 1M reads | $0 |
| KV Writes | $0.50/million | 100,000 | $0.05 |
| KV Reads | Free (10M) | 5M reads | $0 |
| Workers | $0.30/million | 500,000 | $0.15 |
| Bunny CDN | $0.01/GB | 500GB | $5 |
| **Total** | | | **~$20.24** |

## Future Enhancements

### Roadmap

```mermaid
gantt
    title Video Upload Enhancement Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1
    TUS Implementation           :done, 2025-11-01, 30d
    Rate Limiting               :done, 2025-11-15, 14d
    section Phase 2
    WebSocket Progress          :2025-12-01, 30d
    Thumbnail Generation        :2025-12-15, 14d
    section Phase 3
    AI Content Moderation       :2026-01-01, 30d
    Multi-Region Upload         :2026-01-15, 30d
    section Phase 4
    P2P Upload Assistance       :2026-02-01, 45d
    Blockchain Verification     :2026-03-01, 60d
```

## References

- [TUS Protocol Specification](https://tus.io/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Bunny.net API Documentation](https://docs.bunny.net/)
- [R2 Storage Documentation](https://developers.cloudflare.com/r2/)

## Related Documents

- [ADR 0001: Use TUS Protocol for Video Uploads](../adr/0001-use-tus-protocol-for-video-uploads.md)
- [ADR 0002: Signed URL Upload Architecture](../adr/0002-signed-url-upload-architecture.md)
- [ADR 0003: Tiered Rate Limiting](../adr/0003-tiered-rate-limiting-for-uploads.md)
- [ADR 0004: R2-Based Metadata Storage](../adr/0004-r2-based-video-metadata-storage.md)

---

*Last Updated: 2025-11-20*
*Version: 1.0*