# ADR-002: Video Sections Architecture

**Status**: Proposed
**Date**: 2025-11-22
**Author**: Backend Architect

## Context

The Al Ummah Now platform requires a robust system for organizing and displaying video content in various sections (Recent Uploads, Popular Uploads, Trending, Recommended, etc.). The current infrastructure uses Cloudflare Workers with R2 object storage (no traditional database), which presents unique challenges for querying and sorting content efficiently.

### Current State Analysis

1. **Storage Pattern**: Videos are stored as individual JSON objects in R2 buckets with UUID keys
2. **Existing Metrics**: Videos already track views, likes, dislikes, comments counts
3. **Channel Sections**: Existing infrastructure for channel-specific sections (recent_uploads, popular_uploads)
4. **Limitations**:
   - R2 list operations have limited filtering/sorting capabilities
   - No native indexing or complex query support
   - Performance concerns with listing and filtering large datasets

## Decision

Design a multi-layered architecture that leverages R2's strengths while implementing efficient indexing and caching strategies for video sections.

## Architecture Design

### 1. Data Model Enhancements

#### Video Metadata Extensions
```typescript
interface VideoMetrics {
  // Existing metrics
  views: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;

  // New trending metrics
  viewsLast24Hours?: number;
  viewsLast7Days?: number;
  viewsLast30Days?: number;
  engagementRate?: number;      // (likes + comments) / views
  trendingScore?: number;        // Calculated trending score
  lastTrendingUpdate?: string;   // ISO timestamp
}

interface VideoObject {
  // ... existing fields
  metrics?: VideoMetrics;

  // New categorization fields
  isTrending?: boolean;
  trendingRank?: number;
  recommendationScore?: number;
  featuredInSections?: string[]; // Track which sections include this video
}
```

#### Index Structures (Stored in R2)
```typescript
// Time-based index for recent videos
interface RecentVideosIndex {
  id: 'index:recent-videos';
  lastUpdated: string;
  videos: Array<{
    videoId: string;
    dateCreated: string;
    channelId: string;
    title: string;
    thumbnailUrl: string;
  }>;
}

// Popularity index
interface PopularVideosIndex {
  id: 'index:popular-videos';
  lastUpdated: string;
  period: 'all-time' | 'monthly' | 'weekly' | 'daily';
  videos: Array<{
    videoId: string;
    views: number;
    likesCount: number;
    engagementRate: number;
  }>;
}

// Trending index
interface TrendingVideosIndex {
  id: 'index:trending-videos';
  lastUpdated: string;
  algorithm: 'velocity' | 'engagement' | 'hybrid';
  videos: Array<{
    videoId: string;
    trendingScore: number;
    viewsVelocity: number;    // views per hour
    engagementVelocity: number; // engagement per hour
  }>;
}

// Category-specific indices
interface CategoryVideosIndex {
  id: `index:category:${string}`;
  category: VideoCategory;
  lastUpdated: string;
  videos: string[]; // Video IDs
}
```

### 2. API Endpoint Specifications

#### GET /api/videos/sections/recent
```typescript
// Request
{
  query: {
    limit?: number;        // Default: 12, Max: 50
    cursor?: string;       // Pagination cursor
    channelId?: string;    // Filter by channel
    category?: VideoCategory;
    excludeChannels?: string[]; // Exclude specific channels
  }
}

// Response
{
  success: true,
  data: VideoObject[],
  cursor?: string,
  metadata: {
    totalCount?: number,
    lastUpdated: string
  }
}
```

#### GET /api/videos/sections/popular
```typescript
// Request
{
  query: {
    limit?: number;        // Default: 12, Max: 50
    cursor?: string;
    period?: 'all-time' | 'monthly' | 'weekly' | 'daily'; // Default: 'all-time'
    category?: VideoCategory;
    minViews?: number;     // Minimum view threshold
  }
}

// Response (same structure as recent)
```

#### GET /api/videos/sections/trending
```typescript
// Request
{
  query: {
    limit?: number;        // Default: 12, Max: 50
    cursor?: string;
    algorithm?: 'velocity' | 'engagement' | 'hybrid'; // Default: 'hybrid'
    timeWindow?: '6h' | '12h' | '24h' | '48h';       // Default: '24h'
    category?: VideoCategory;
    region?: string;       // Geographic region (future enhancement)
  }
}

// Response includes trending metadata
{
  success: true,
  data: Array<VideoObject & {
    trendingMetadata: {
      rank: number;
      score: number;
      viewsVelocity: number;
      percentageIncrease: number;
      peakTime?: string;
    }
  }>,
  cursor?: string,
  metadata: {
    algorithmVersion: string,
    lastCalculated: string,
    nextUpdate: string
  }
}
```

#### GET /api/videos/sections/recommended
```typescript
// Request
{
  query: {
    limit?: number;        // Default: 12, Max: 50
    cursor?: string;
    strategy?: 'popular' | 'category-based' | 'random'; // Default: 'popular'
    excludeWatched?: boolean; // Exclude user's watch history
    seedVideoId?: string;     // Base recommendations on this video
  },
  headers: {
    userId?: string;       // For personalized recommendations (optional)
  }
}

// Response (same structure as recent)
```

#### GET /api/videos/sections/by-category/{category}
```typescript
// Request
{
  params: {
    category: VideoCategory;
  },
  query: {
    limit?: number;
    cursor?: string;
    sort?: 'recent' | 'popular' | 'trending';
    subCategory?: string;  // For more granular filtering
  }
}
```

### 3. R2 Query Strategy

#### Hybrid Approach: Indices + Direct Queries

1. **Primary Strategy: Pre-computed Indices**
   - Store pre-computed indices in R2 for each section type
   - Update indices periodically via scheduled workers
   - Serve requests directly from indices (fast reads)

2. **Index Update Strategy**
   ```typescript
   // Scheduled worker runs every 5 minutes for trending
   async function updateTrendingIndex(env) {
     const videos = await getAllVideosWithMetrics(env);
     const trending = calculateTrendingScores(videos);
     await env.videos.put('index:trending-videos', JSON.stringify({
       id: 'index:trending-videos',
       lastUpdated: new Date().toISOString(),
       algorithm: 'hybrid',
       videos: trending.slice(0, 100) // Top 100 trending
     }));
   }
   ```

3. **Fallback Strategy: Direct Computation**
   - If index is stale (> 30 minutes) or missing
   - Compute results on-demand with caching
   - Trigger background index rebuild

#### Storage Layout
```
R2 Bucket Structure:
/videos/
  ├── {videoId}                    # Individual video objects
  ├── index:recent-videos          # Recent videos index
  ├── index:popular-videos:all     # All-time popular
  ├── index:popular-videos:monthly # Monthly popular
  ├── index:popular-videos:weekly  # Weekly popular
  ├── index:trending-videos        # Trending videos
  ├── index:category:{category}    # Category indices
  └── metadata:last-index-update   # Index update tracking
```

### 4. Performance Optimizations

#### Caching Strategy (using Cloudflare KV)
```typescript
interface CachedSection {
  key: `cache:section:${string}`;
  data: VideoObject[];
  expires: number;      // Unix timestamp
  etag: string;
}

// Cache popular sections for 5 minutes
const CACHE_TTL = {
  recent: 60,          // 1 minute (changes frequently)
  popular: 300,        // 5 minutes
  trending: 180,       // 3 minutes
  recommended: 300,    // 5 minutes
  category: 600,       // 10 minutes
};
```

#### Query Optimization Techniques

1. **Parallel Fetching**
   ```typescript
   // Fetch video details in parallel after getting IDs from index
   const videoIds = trendingIndex.videos.map(v => v.videoId);
   const videos = await Promise.all(
     videoIds.map(id => videoRepo.getObject(id))
   );
   ```

2. **Partial Object Loading**
   ```typescript
   // Store lightweight index with minimal fields
   // Fetch full objects only for returned page
   const index = await getIndex('trending');
   const pageIds = index.videos.slice(offset, offset + limit);
   const fullVideos = await fetchVideos(pageIds);
   ```

3. **Smart Pagination**
   ```typescript
   // Use cursor-based pagination with encoded position
   const cursor = base64Encode({
     lastId: videos[videos.length - 1].id,
     lastScore: videos[videos.length - 1].trendingScore,
     offset: currentOffset + limit
   });
   ```

### 5. Trending Algorithm

```typescript
function calculateTrendingScore(video: VideoObject): number {
  const now = Date.now();
  const ageInHours = (now - new Date(video.dateCreated).getTime()) / (1000 * 60 * 60);

  // Recent views weight more
  const recentViews = video.viewsLast24Hours || 0;
  const totalViews = video.views || 0;

  // Engagement metrics
  const engagementRate = totalViews > 0
    ? ((video.likesCount + video.commentsCount) / totalViews)
    : 0;

  // Velocity (views per hour in last 24h)
  const velocity = recentViews / Math.min(ageInHours, 24);

  // Score calculation (can be tuned)
  const score =
    (velocity * 100) +                    // Velocity weight: 100
    (recentViews * 10) +                   // Recent views weight: 10
    (totalViews * 0.1) +                   // Total views weight: 0.1
    (engagementRate * 1000) +              // Engagement weight: 1000
    (1 / Math.log(ageInHours + 2)) * 50;   // Freshness bonus

  return Math.round(score);
}
```

### 6. Implementation Phases

#### Phase 1: Foundation (Week 1)
- Implement index structures in R2
- Create index update workers
- Build Recent and Popular endpoints

#### Phase 2: Trending (Week 2)
- Implement trending algorithm
- Create trending index updater
- Build Trending endpoint with multiple algorithms

#### Phase 3: Recommendations (Week 3)
- Basic recommendation engine (category-based)
- Recommended endpoint
- Watch history integration

#### Phase 4: Optimization (Week 4)
- Implement KV caching layer
- Performance tuning
- Add monitoring and metrics

## Consequences

### Positive
- **Scalable**: Index-based approach scales well with content growth
- **Fast Reads**: Pre-computed indices enable sub-second response times
- **Flexible**: Multiple algorithms and strategies for different use cases
- **Cost-Effective**: Minimizes R2 read operations through caching
- **Maintainable**: Clear separation between index management and API serving

### Negative
- **Eventually Consistent**: Indices may be slightly out of date (5-30 minutes)
- **Storage Overhead**: Duplicate data in indices increases storage costs
- **Complexity**: Managing multiple indices and cache layers adds complexity
- **Cold Start**: Initial index building for new deployments takes time

### Mitigations
- Use aggressive caching to minimize index staleness impact
- Implement on-demand computation for critical real-time needs
- Monitor index sizes and implement cleanup policies
- Provide clear documentation and tooling for index management

## Alternatives Considered

1. **Direct R2 Queries Only**
   - Rejected: Too slow for large datasets, limited query capabilities

2. **External Database (PostgreSQL/MongoDB)**
   - Rejected: Adds infrastructure complexity, against current architecture

3. **Cloudflare Durable Objects for Indices**
   - Rejected: More complex, higher costs, overkill for this use case

4. **Client-Side Sorting/Filtering**
   - Rejected: Poor UX, doesn't scale, security concerns

## Related Decisions
- ADR-001: Channel Settings Refactor (establishes UI patterns)
- Future ADR: Video Recommendation Engine
- Future ADR: Analytics and Metrics Pipeline

## References
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Trending Algorithm Research](https://medium.com/hacking-and-gonzo/how-reddit-ranking-algorithms-work-ef111e33d0d9)
- [YouTube's Recommendation System](https://research.google/pubs/pub45530/)

## Implementation Notes for Developers

### Key Files to Modify/Create

1. **New Endpoints** (`apps/api-videos/src/endpoints/sections/`)
   - `recentVideos.ts`
   - `popularVideos.ts`
   - `trendingVideos.ts`
   - `recommendedVideos.ts`
   - `categoryVideos.ts`

2. **Index Management** (`apps/api-videos/src/lib/`)
   - `indexManager.ts` - Index CRUD operations
   - `trendingAlgorithm.ts` - Trending score calculation
   - `recommendationEngine.ts` - Basic recommendation logic

3. **Scheduled Workers** (`apps/api-videos/src/workers/`)
   - `indexUpdater.ts` - Periodic index updates
   - `metricsCalculator.ts` - Update video metrics

4. **Shared Types** (`packages/shared-types/src/`)
   - Extend `video.ts` with new metric fields
   - Create `video-sections.ts` for section-specific types

### Testing Strategy

1. **Unit Tests**
   - Trending algorithm calculations
   - Index update logic
   - Recommendation scoring

2. **Integration Tests**
   - API endpoint responses
   - Index consistency
   - Cache invalidation

3. **Performance Tests**
   - Response times with 10K+ videos
   - Index update duration
   - Cache hit rates

### Monitoring and Metrics

Track these KPIs:
- API response times per section type
- Cache hit rates
- Index update frequency and duration
- Trending algorithm accuracy (CTR on trending videos)
- User engagement with different sections

### Security Considerations

- Rate limit section endpoints (100 req/min per IP)
- Validate all query parameters
- Sanitize cursor tokens to prevent injection
- Respect video privacy settings in all sections
- Implement proper CORS headers

## Conclusion

This architecture provides a robust, scalable solution for video sections that works within the constraints of R2 object storage while delivering fast, relevant content to users. The index-based approach with intelligent caching ensures good performance while maintaining flexibility for future enhancements.