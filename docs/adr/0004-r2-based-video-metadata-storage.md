# ADR 0004: R2-Based Video Metadata Storage

## Status
Accepted

## Context

Al Ummah Now needs to store video metadata including:
- Basic information (title, description, tags)
- Upload status and progress
- User relationships (owner, channel)
- Engagement metrics (views, likes, comments)
- Processing state (encoding status, available resolutions)

Traditional approaches would use a relational database (PostgreSQL) or NoSQL database (MongoDB). However, as a Cloudflare Workers application, we need a serverless-compatible storage solution that:
- Works with edge computing
- Scales automatically
- Requires no maintenance
- Supports global distribution
- Offers predictable pricing

## Decision

We will use **Cloudflare R2** as our primary data store for video metadata, treating it as a document database:

1. **Storage Pattern**: Each video stored as a JSON document
2. **Key Structure**: Video ID as the object key
3. **Bucket Organization**: Separate buckets for videos, profiles, channels, playlists
4. **Repository Pattern**: Generic R2Repository class for CRUD operations
5. **No Traditional Database**: R2 serves as both object store and metadata store

### Data Model Example

```typescript
// Stored in R2 as: videos/{videoId}.json
{
  "id": "abc123-def456",
  "title": "Introduction to Islamic History",
  "titleLocalized": {
    "en": "Introduction to Islamic History",
    "ar": "مقدمة في التاريخ الإسلامي"
  },
  "description": "A comprehensive overview...",
  "userId": "user123",
  "channelId": "channel456",
  "dateCreated": "2025-11-20T10:00:00Z",
  "dateModified": "2025-11-20T12:00:00Z",
  "views": 1250,
  "likesCount": 89,
  "dislikesCount": 2,
  "commentsCount": 15,
  "availableResolutions": ["240p", "360p", "720p", "1080p"],
  "uploadStatus": "ready",
  "fileSize": 125000000,
  "duration": 600,
  "tags": ["history", "education", "islamic"],
  "isPublic": true,
  "bunnyVideoId": "xyz789",
  "bunnyLibraryId": 12345
}
```

## Rationale

### 1. Perfect Fit for Serverless
- **No connection pooling issues**: Direct HTTP API
- **No cold start penalties**: No database connections to establish
- **Edge-compatible**: Works globally with Cloudflare Workers

### 2. Cost-Effective
- **Pay-per-use pricing**: $0.015/GB/month storage, $0.36-$0.00/million requests
- **No idle costs**: No database instances to maintain
- **Included operations**: 10 million free reads, 1 million free writes/month

### 3. Simplicity
- **No schema migrations**: JSON documents evolve naturally
- **No ORM needed**: Direct object storage and retrieval
- **No maintenance**: Fully managed by Cloudflare

### 4. Performance
- **Global distribution**: Data replicated across regions
- **Edge caching**: Frequently accessed data cached at edge
- **Low latency**: Direct access from Workers

### 5. Scalability
- **Automatic scaling**: No capacity planning needed
- **Unlimited storage**: No size limits on buckets
- **High throughput**: Handles millions of requests

## Consequences

### Positive

1. **Reduced Complexity**: No database server management
2. **Lower Costs**: Typically 70-90% cheaper than managed databases
3. **Better Reliability**: S3-compatible with 99.999999999% durability
4. **Faster Development**: Simple JSON storage/retrieval
5. **Global Performance**: Data close to users worldwide
6. **Version Control Friendly**: JSON documents easy to track

### Negative

1. **No Complex Queries**: Can't do JOINs or aggregations
   - *Mitigation*: Denormalize data, use KV for indexes
   - *Example*: Store channel info in video document

2. **Limited Filtering**: List operations basic (prefix, cursor)
   - *Mitigation*: Implement search via separate index (KV or external service)
   - *Example*: Channel videos indexed in KV as `channel:{id}:videos`

3. **Eventual Consistency**: Not ACID compliant
   - *Mitigation*: Design for eventual consistency, use optimistic locking
   - *Example*: Version field for conflict detection

4. **No Transactions**: Can't update multiple objects atomically
   - *Mitigation*: Design around single-document updates
   - *Example*: Queue events for multi-document operations

5. **Manual Indexing**: Must maintain secondary indexes
   - *Mitigation*: Use KV for frequently accessed indexes
   - *Example*: `user:{id}:videos` → list of video IDs

## Alternatives Considered

### 1. Cloudflare D1 (SQLite) - Rejected
**Approach**: Use Cloudflare's managed SQLite database
**Pros**: SQL queries, ACID transactions, familiar
**Cons**:
- Beta product with limitations
- 10GB size limit per database
- Regional (not global)
- More complex for JSON data

### 2. External Database (Supabase/Neon) - Rejected
**Approach**: Use external PostgreSQL service
**Pros**: Full SQL, mature ecosystem, complex queries
**Cons**:
- Latency from Workers to database
- Connection pooling complexity
- Higher costs ($25+/month minimum)
- Not edge-native

### 3. Cloudflare KV Only - Rejected
**Approach**: Use KV for all data storage
**Pros**: Very fast reads, global distribution
**Cons**:
- 25MB value size limit
- More expensive for large data
- Limited listing capabilities
- Not ideal for large JSON documents

### 4. Hybrid (KV + R2) - Complementary
**Approach**: KV for indexes/cache, R2 for documents
**Pros**: Best of both worlds
**Cons**: More complex
**Note**: This is actually used for specific optimizations

## Implementation Notes

### Repository Pattern

```typescript
class R2Repository<T> {
  constructor(private bucket: R2Bucket) {}

  async getObject(key: string): Promise<T | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return await object.json<T>();
  }

  async putObject(key: string, data: T): Promise<void> {
    await this.bucket.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  async listObjects(options?: R2ListOptions): Promise<R2Objects> {
    return await this.bucket.list(options);
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
```

### Pagination Strategy

```typescript
// Cursor-based pagination using R2 list
const result = await bucket.list({
  limit: 20,
  cursor: request.cursor,
  prefix: 'videos/',
});

return {
  items: await Promise.all(
    result.objects.map(obj => obj.json())
  ),
  nextCursor: result.truncated ? result.cursor : null
};
```

### Indexing Strategy

```typescript
// Secondary index in KV for user's videos
await kv.put(
  `user:${userId}:videos`,
  JSON.stringify(videoIds),
  { expirationTtl: 3600 } // Cache for 1 hour
);

// Query user's videos
const videoIds = await kv.get(`user:${userId}:videos`, 'json');
const videos = await Promise.all(
  videoIds.map(id => videosRepo.getObject(id))
);
```

### Migration Path

1. **Initial Implementation**: Direct R2 storage
2. **Optimization Phase 1**: Add KV caching for hot data
3. **Optimization Phase 2**: Implement search index
4. **Future Consideration**: Evaluate D1 when stable

## Performance Considerations

### Read Optimization
- Cache frequently accessed videos in KV (TTL: 5 minutes)
- Use R2 conditional requests (ETags)
- Implement edge caching for public videos

### Write Optimization
- Batch metadata updates when possible
- Use queues for non-critical updates (view counts)
- Implement write-through cache

### Query Optimization
- Denormalize common relationships
- Maintain KV indexes for common queries
- Consider external search service for complex queries

## Monitoring

1. **Metrics to Track**:
   - R2 request latency
   - Cache hit ratios
   - Storage growth rate
   - Request costs

2. **Alerts**:
   - High error rates
   - Unusual request patterns
   - Storage quota approaching

## Future Enhancements

1. **Search Service**: Elasticsearch/Algolia for full-text search
2. **Analytics Database**: ClickHouse for metrics/analytics
3. **Graph Relationships**: Neo4j for recommendations
4. **Time-Series Data**: InfluxDB for detailed metrics

## References

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers KV Documentation](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Edge Storage Patterns](https://blog.cloudflare.com/building-applications-with-cloudflare-workers-and-r2/)

## Decision Date
2025-11-20

## Last Updated
2025-11-20