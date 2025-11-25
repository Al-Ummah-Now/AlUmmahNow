# Video Search API Performance Optimization Plan

## Executive Summary

The video search API currently experiences **~15 second response times** due to fetching 1000 objects from R2 on every request, with each object requiring an individual GET operation. This document outlines a comprehensive three-tier optimization strategy to reduce response times to **<500ms** for typical searches and **<2s** for complex queries.

### Key Metrics
- **Current Performance**: ~15 seconds average response time
- **Target Performance**: <500ms (97% reduction)
- **User Impact**: Affects all search operations, browse pages, and discovery features
- **Cost Impact**: Excessive R2 API calls (~1001 operations per search)

## Current Performance Analysis

### 1. Architecture Overview
```
Request → VideoSearch.handle()
        → R2Repository.listObjects(1000)
        → R2 LIST (1 operation)
        → Promise.all(1000x R2 GET operations)
        → In-memory filtering
        → In-memory sorting
        → Pagination
        → Response
```

### 2. Performance Bottlenecks

#### Primary Bottleneck: R2 Operations
- **R2 LIST operation**: ~200ms for 1000 keys
- **1000x R2 GET operations**: 1000 × 10-20ms = 10-20 seconds
- **Total R2 time**: ~15 seconds
- **Processing overhead**: ~500ms (filtering, sorting, transformation)

#### Secondary Issues
1. **No caching layer**: Every request hits R2 directly
2. **Inefficient pagination**: Fetches all data even for page 1
3. **In-memory filtering**: All filtering happens after data fetch
4. **No query optimization**: Simple searches fetch same data as complex ones
5. **Missing indexes**: No search indexes or pre-computed views

### 3. R2 API Limitations
- **LIST operation**: Maximum 1000 objects per request
- **GET operation**: Individual requests, no bulk fetch
- **Latency**: 10-20ms per GET operation
- **Cost**: $0.36 per million Class A operations (LIST)
- **Cost**: $0.04 per million Class B operations (GET)

## Three-Tier Optimization Strategy

## Phase 1: Short-Term Optimizations (0-2 weeks)
**Goal**: Reduce response time to **<3 seconds** with minimal changes

### 1.1 Reduce R2 Query Limit ⚡ **QUICK WIN**
```typescript
// Current: Fetches 1000 objects
let videos = await repository.listObjects(1000);

// Optimized: Fetch only what's needed
const fetchLimit = Math.min(limit * 3, 200); // 3x for filtering buffer
let videos = await repository.listObjects(fetchLimit, cursor);
```
- **Impact**: 80% reduction in R2 GET operations
- **Effort**: 1 hour
- **Risk**: Low

### 1.2 Implement Request-Level Caching
```typescript
// Add to VideoSearch class
private static cache = new Map<string, CachedResult>();
private static CACHE_TTL = 60000; // 1 minute

private getCacheKey(request): string {
  return JSON.stringify({
    q: request.query.q,
    filter: request.query.filter,
    sort: request.query.sort,
    channelIds: request.query.channelIds,
    durationFilter: request.query.durationFilter,
    cursor: request.query.cursor
  });
}
```
- **Impact**: 90% hit rate for repeated searches
- **Effort**: 2 hours
- **Risk**: Low

### 1.3 Add CDN Cache Headers
```typescript
// Add to response
return c.json(response, {
  headers: {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
    'CDN-Cache-Control': 'max-age=300',
    'Vary': 'Authorization'
  }
});
```
- **Impact**: Edge caching for anonymous users
- **Effort**: 30 minutes
- **Risk**: Low

### 1.4 Optimize Filter Logic
```typescript
// Move privacy filter to R2 prefix
const prefix = filter === 'public' ? 'public/' :
               filter === 'private' ? 'private/' :
               undefined;
const listResult = await this.bucket.list({
  limit: fetchLimit,
  cursor,
  prefix
});
```
- **Impact**: 30% reduction in data fetched
- **Effort**: 2 hours
- **Risk**: Medium (requires data migration)

### 1.5 Parallel Processing for Transform Operations
```typescript
// Current: Sequential processing
const transformedVideos = videos.map(transformToView);

// Optimized: Parallel channel data fetch
const [videos, channels] = await Promise.all([
  repository.listObjects(fetchLimit, cursor),
  channelRepo.getBatch(channelIds) // New batch method
]);
```
- **Impact**: 20% faster transformation
- **Effort**: 3 hours
- **Risk**: Low

## Phase 2: Medium-Term Improvements (2-6 weeks)
**Goal**: Reduce response time to **<1 second** with architectural improvements

### 2.1 Implement Cloudflare KV Cache Layer
```typescript
// wrangler.jsonc addition
{
  "kv_namespaces": [
    {
      "binding": "VIDEO_CACHE",
      "id": "VIDEO_CACHE_ID"
    },
    {
      "binding": "SEARCH_INDEX",
      "id": "SEARCH_INDEX_ID"
    }
  ]
}

// Implementation
class VideoCache {
  constructor(private kv: KVNamespace) {}

  async getVideo(id: string): Promise<Video | null> {
    const cached = await this.kv.get(id, 'json');
    if (cached) return cached;

    const video = await this.r2.get(id);
    if (video) {
      await this.kv.put(id, JSON.stringify(video), {
        expirationTtl: 3600 // 1 hour
      });
    }
    return video;
  }

  async getMultiple(ids: string[]): Promise<Video[]> {
    // KV supports up to 128 keys in parallel
    const chunks = chunk(ids, 128);
    const results = await Promise.all(
      chunks.map(chunk =>
        Promise.all(chunk.map(id => this.getVideo(id)))
      )
    );
    return results.flat().filter(Boolean);
  }
}
```
- **Impact**: 95% cache hit rate, <50ms per video fetch
- **Effort**: 1 week
- **Risk**: Medium

### 2.2 Pre-computed Search Indexes
```typescript
// Store pre-computed indexes in KV
interface SearchIndex {
  recent: string[];        // Last 1000 video IDs by date
  popular: string[];       // Top 1000 by views
  channels: Record<string, string[]>; // Videos per channel
  tags: Record<string, string[]>;     // Videos per tag
}

// Update index on video create/update
async function updateSearchIndex(video: Video) {
  const index = await kv.get('search:index', 'json') || {};

  // Update recent
  index.recent.unshift(video.id);
  index.recent = index.recent.slice(0, 1000);

  // Update channel index
  if (!index.channels[video.channelId]) {
    index.channels[video.channelId] = [];
  }
  index.channels[video.channelId].unshift(video.id);

  await kv.put('search:index', JSON.stringify(index));
}
```
- **Impact**: Instant retrieval for common queries
- **Effort**: 1 week
- **Risk**: Medium

### 2.3 Smart Pagination with Cursor Optimization
```typescript
interface PaginationCursor {
  lastScore: number;
  lastId: string;
  searchParams: SearchParams;
  cachedIds?: string[]; // Cache next page IDs
}

// Encode cursor with next page hint
const cursor = base64Encode({
  lastScore: lastVideo.score,
  lastId: lastVideo.id,
  searchParams: params,
  cachedIds: nextPageIds.slice(0, 20)
});
```
- **Impact**: 50% faster pagination
- **Effort**: 3 days
- **Risk**: Low

### 2.4 Implement Batch Operations in R2Repository
```typescript
class R2Repository<T> {
  async getBatch(ids: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();

    // Use Promise.allSettled for resilience
    const promises = ids.map(async id => ({
      id,
      data: await this.getObject(id)
    }));

    const settled = await Promise.allSettled(promises);

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.data) {
        results.set(result.value.id, result.value.data);
      }
    }

    return results;
  }

  // Optimized list with metadata only
  async listMetadata(limit: number, cursor?: string) {
    const listResult = await this.bucket.list({
      limit,
      cursor,
      include: ['customMetadata'] // R2 feature
    });

    return {
      cursor: listResult.cursor,
      items: listResult.objects.map(obj => ({
        id: obj.key,
        metadata: obj.customMetadata,
        size: obj.size,
        uploaded: obj.uploaded
      }))
    };
  }
}
```
- **Impact**: 60% reduction in data transfer
- **Effort**: 3 days
- **Risk**: Low

### 2.5 Query Result Caching Strategy
```typescript
class QueryCache {
  // Cache popular queries for longer
  private static POPULAR_QUERIES = [
    { q: '', sort: 'date' },           // Homepage
    { q: '', sort: 'views' },           // Popular
    { filter: 'live' },                 // Live streams
  ];

  async get(params: SearchParams): Promise<SearchResult | null> {
    const key = this.getCacheKey(params);
    const ttl = this.isPopularQuery(params) ? 300 : 60;

    return await this.kv.get(key, 'json');
  }

  async set(params: SearchParams, result: SearchResult) {
    const key = this.getCacheKey(params);
    const ttl = this.isPopularQuery(params) ? 300 : 60;

    await this.kv.put(key, JSON.stringify(result), {
      expirationTtl: ttl
    });
  }
}
```
- **Impact**: 80% cache hit rate for common queries
- **Effort**: 2 days
- **Risk**: Low

## Phase 3: Long-Term Strategy (6+ weeks)
**Goal**: Reduce response time to **<500ms** with advanced search capabilities

### 3.1 Implement Full-Text Search with Cloudflare D1
```typescript
// Create D1 database schema
CREATE VIRTUAL TABLE videos_fts USING fts5(
  id,
  title,
  description,
  tags,
  channelId,
  views,
  dateCreated,
  isPublic,
  duration
);

// Search implementation
class D1SearchEngine {
  async search(query: string, filters: Filters): Promise<string[]> {
    const sql = `
      SELECT id,
             bm25(videos_fts) as score
      FROM videos_fts
      WHERE videos_fts MATCH ?
        AND isPublic = ?
        ${filters.channelId ? 'AND channelId = ?' : ''}
      ORDER BY score DESC
      LIMIT ? OFFSET ?
    `;

    const results = await this.d1.prepare(sql)
      .bind(query, filters.isPublic, limit, offset)
      .all();

    return results.results.map(r => r.id);
  }
}
```
- **Impact**: <100ms full-text search
- **Effort**: 2 weeks
- **Risk**: High (new technology)

### 3.2 Alternative: Algolia Integration
```typescript
// Algolia integration for powerful search
import algoliasearch from 'algoliasearch';

class AlgoliaSearchEngine {
  private index;

  constructor() {
    const client = algoliasearch(APP_ID, API_KEY);
    this.index = client.initIndex('videos');
  }

  async indexVideo(video: Video) {
    await this.index.saveObject({
      objectID: video.id,
      title: video.title,
      description: video.description,
      tags: video.tags,
      channelId: video.channelId,
      views: video.views,
      dateCreated: video.dateCreated,
      _geoloc: video.location // Geographic search
    });
  }

  async search(query: string, filters: SearchFilters) {
    const results = await this.index.search(query, {
      filters: this.buildFilters(filters),
      facets: ['channelId', 'tags', 'duration'],
      hitsPerPage: filters.limit,
      page: filters.page
    });

    return results.hits.map(hit => hit.objectID);
  }
}
```
- **Impact**: <50ms search with typo tolerance, facets, analytics
- **Effort**: 1 week
- **Risk**: Medium (external dependency)
- **Cost**: ~$50/month for 100k searches

### 3.3 Event-Driven Index Updates
```typescript
// Use Cloudflare Queues for async indexing
class IndexUpdateQueue {
  async handleVideoUpdate(message: VideoUpdateMessage) {
    const { videoId, operation } = message;

    switch (operation) {
      case 'create':
      case 'update':
        const video = await this.r2.get(videoId);
        await Promise.all([
          this.updateKVCache(video),
          this.updateSearchIndex(video),
          this.updateD1Index(video)
        ]);
        break;

      case 'delete':
        await Promise.all([
          this.removeFromKVCache(videoId),
          this.removeFromSearchIndex(videoId),
          this.removeFromD1Index(videoId)
        ]);
        break;
    }
  }
}
```
- **Impact**: Real-time index updates
- **Effort**: 1 week
- **Risk**: Low

### 3.4 Implement Faceted Search
```typescript
interface FacetedSearchResult {
  results: Video[];
  facets: {
    channels: Array<{ id: string; name: string; count: number }>;
    durations: Array<{ range: string; count: number }>;
    dates: Array<{ period: string; count: number }>;
    tags: Array<{ tag: string; count: number }>;
  };
  stats: {
    totalResults: number;
    searchTime: number;
  };
}

class FacetedSearch {
  async search(params: SearchParams): Promise<FacetedSearchResult> {
    // Parallel facet computation
    const [results, facets] = await Promise.all([
      this.getSearchResults(params),
      this.computeFacets(params)
    ]);

    return { results, facets, stats };
  }
}
```
- **Impact**: Rich search experience
- **Effort**: 1 week
- **Risk**: Medium

### 3.5 Personalized Search with ML
```typescript
// Use Cloudflare Vectorize for semantic search
class SemanticSearch {
  async indexVideo(video: Video) {
    // Generate embedding using Workers AI
    const embedding = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: `${video.title} ${video.description}`
    });

    await this.vectorize.upsert([{
      id: video.id,
      values: embedding.data[0],
      metadata: { channelId: video.channelId }
    }]);
  }

  async search(query: string, userId: string) {
    // Get user preferences
    const userPrefs = await this.getUserPreferences(userId);

    // Generate query embedding
    const queryEmbedding = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: query
    });

    // Vector similarity search
    const results = await this.vectorize.query(queryEmbedding.data[0], {
      topK: 100,
      filter: { userId }
    });

    // Re-rank based on user preferences
    return this.personalizeResults(results, userPrefs);
  }
}
```
- **Impact**: 30% better relevance for users
- **Effort**: 2 weeks
- **Risk**: High (complex implementation)

## Implementation Priority Matrix

### High Impact, Low Effort (DO FIRST) ⚡
1. **Reduce R2 query limit** - 1 hour, 80% improvement
2. **Add CDN cache headers** - 30 min, edge caching
3. **Request-level caching** - 2 hours, 90% cache hits
4. **Optimize filter logic** - 2 hours, 30% reduction

### High Impact, High Effort (STRATEGIC) 🎯
1. **KV cache layer** - 1 week, 95% cache hits
2. **D1/Algolia search** - 2 weeks, <100ms search
3. **Pre-computed indexes** - 1 week, instant common queries

### Low Impact, Low Effort (QUICK WINS) ✅
1. **Parallel transformations** - 3 hours, 20% faster
2. **Batch operations** - 3 days, 60% less transfer
3. **Smart cursors** - 3 days, 50% faster pagination

### Low Impact, High Effort (DEFER) ⏸️
1. **ML personalization** - 2 weeks, complex
2. **Geographic search** - 1 week, limited use
3. **Advanced analytics** - 2 weeks, nice-to-have

## Cost-Benefit Analysis

### Current Costs (Monthly)
- **R2 Operations**: 10M searches × 1001 ops = 10B operations
  - LIST: 10M × $0.36/M = $3.60
  - GET: 10B × $0.04/M = $400
- **Total**: ~$404/month

### Optimized Costs (Phase 1)
- **R2 Operations**: 10M searches × 201 ops = 2B operations
  - LIST: 10M × $0.36/M = $3.60
  - GET: 2B × $0.04/M = $80
- **Total**: ~$84/month (79% reduction)

### Optimized Costs (Phase 2 with KV)
- **R2 Operations**: 10M searches × 20 ops = 200M operations
  - R2: 200M × $0.04/M = $8
  - KV: 10M × 10 reads × $0.50/M = $50
- **Total**: ~$58/month (86% reduction)

### ROI Timeline
- **Phase 1**: $320/month savings, 2 weeks effort
- **Phase 2**: $346/month savings, 6 weeks effort
- **Phase 3**: Improved user experience, new capabilities

## Monitoring and Metrics Strategy

### Key Performance Indicators (KPIs)
```typescript
interface PerformanceMetrics {
  // Response Time Metrics
  p50ResponseTime: number;      // Target: <200ms
  p95ResponseTime: number;      // Target: <500ms
  p99ResponseTime: number;      // Target: <1s

  // Cache Metrics
  cacheHitRate: number;         // Target: >80%
  kvCacheHitRate: number;       // Target: >95%
  cdnCacheHitRate: number;      // Target: >60%

  // Operational Metrics
  r2OperationsPerSearch: number; // Target: <50
  searchesPerSecond: number;     // Capacity metric
  errorRate: number;            // Target: <0.1%

  // Business Metrics
  searchAbandonmentRate: number; // Target: <5%
  searchToViewConversion: number;// Target: >40%
}
```

### Monitoring Implementation
```typescript
class PerformanceMonitor {
  async trackSearch(request: SearchRequest, response: SearchResponse) {
    const metrics = {
      timestamp: Date.now(),
      searchId: crypto.randomUUID(),
      query: request.q,
      responseTime: response.searchTime,
      resultCount: response.totalResults,
      cacheHit: response.fromCache,
      r2Operations: response.r2Operations,
      userId: request.userId,
      errors: response.errors
    };

    // Send to analytics
    await this.queue.send('analytics', metrics);

    // Real-time alerting
    if (metrics.responseTime > 2000) {
      await this.alert('High search latency', metrics);
    }
  }
}
```

### Dashboards and Alerts
1. **Real-time Dashboard**
   - Current QPS
   - Response time histogram
   - Cache hit rates
   - Error rates

2. **Alerts**
   - Response time > 2s (warning)
   - Response time > 5s (critical)
   - Cache hit rate < 50% (warning)
   - Error rate > 1% (critical)

3. **Analytics Reports**
   - Daily search volume trends
   - Popular search queries
   - User search patterns
   - Performance by query type

## Implementation Timeline

### Week 1-2: Quick Wins
- [ ] Reduce R2 query limit
- [ ] Add CDN cache headers
- [ ] Implement request-level caching
- [ ] Deploy and monitor

### Week 3-4: Foundation
- [ ] Set up KV namespaces
- [ ] Implement KV cache layer
- [ ] Add batch operations
- [ ] Performance testing

### Week 5-8: Search Infrastructure
- [ ] Evaluate D1 vs Algolia
- [ ] Implement chosen solution
- [ ] Build search indexes
- [ ] Migration strategy

### Week 9-12: Advanced Features
- [ ] Faceted search
- [ ] Personalization
- [ ] A/B testing
- [ ] Performance optimization

## Risk Mitigation

### Technical Risks
1. **KV Consistency**: Use TTLs and cache invalidation
2. **Index Staleness**: Queue-based updates with retry
3. **Cost Overrun**: Monitor usage, implement rate limiting
4. **Complexity**: Gradual rollout with feature flags

### Operational Risks
1. **Rollback Plan**: Each phase independently deployable
2. **Testing**: Load testing before each release
3. **Monitoring**: Comprehensive metrics and alerting
4. **Documentation**: Update API docs and runbooks

## Success Criteria

### Phase 1 Success (Week 2)
- ✅ Response time < 3 seconds
- ✅ 80% reduction in R2 operations
- ✅ No increase in error rate

### Phase 2 Success (Week 8)
- ✅ Response time < 1 second
- ✅ 95% cache hit rate
- ✅ Cost reduction > 80%

### Phase 3 Success (Week 12)
- ✅ Response time < 500ms
- ✅ Full-text search capability
- ✅ Faceted search
- ✅ 99.9% availability

## Conclusion

This optimization plan provides a clear path from the current 15-second response times to sub-500ms performance. The phased approach ensures quick wins while building toward a robust, scalable search infrastructure. Priority should be given to Phase 1 optimizations for immediate impact, followed by the KV cache layer in Phase 2 for sustained performance improvements.

### Next Steps
1. **Immediate**: Implement R2 query limit reduction (1 hour effort)
2. **This Week**: Deploy Phase 1 optimizations
3. **This Month**: Complete Phase 2 KV implementation
4. **This Quarter**: Evaluate and implement Phase 3 search engine

### Expected Outcomes
- **User Experience**: 97% faster searches
- **Cost Reduction**: 86% lower operational costs
- **Scalability**: 100x capacity increase
- **Features**: Advanced search capabilities