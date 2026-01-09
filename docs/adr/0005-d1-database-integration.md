# ADR-0005: Hybrid Data Layer Architecture (D1 + Analytics Engine + Vectorize)

## Status

**Proposed** | Date: 2025-11-24

## Context

### Current Problem

The Al Ummah Now video platform uses Cloudflare R2 as the primary data store, storing entities as JSON objects. List endpoints currently:

1. **Fetch all items** from R2 via cursor-based pagination
2. **Deserialize each JSON object** into memory
3. **Filter in memory** for `isDeleted`, `isHidden`, `isPrivate`, etc.
4. **Sort in memory** by date, views, likes, etc.
5. **Return paginated results** to the client

**Performance Impact:**
- Linear scan of all objects regardless of filter criteria
- N+1 read pattern (list + get each object)
- Memory pressure with large datasets
- Pagination breaks when filtering (cursor may skip valid items)
- Sort requires loading all data

**Affected Endpoints:**
- `GET /api/videos` - Video list (VideosList)
- `GET /api/channels` - Channel list (ChannelsList)
- `GET /api/playlists` - Playlist list
- `GET /api/channels/{id}/sections` - Channel sections
- `GET /api/channels/{id}/posts` - Community posts (ListCommunityPosts)

### Scale Concerns

Current approach does not scale:
- 1,000 videos: ~1,000 R2 reads per list request
- 10,000 videos: ~10,000 R2 reads per list request
- Cloudflare Workers has a 128MB memory limit

### Why D1?

Cloudflare D1 provides:
- SQLite at the edge (same datacenter as Workers)
- SQL queries with indexes (WHERE, ORDER BY, LIMIT)
- Transaction support
- ~10ms query latency
- 25GB free tier per database

## Decision

Implement a **hybrid multi-layer architecture** using Cloudflare services:

| Service | Purpose | Data Type | Write Pattern |
|---------|---------|-----------|---------------|
| **R2** | Source of truth | Full entity JSON | Write-through |
| **D1** | Queryable indexes | Metadata, relationships | Batch sync |
| **Analytics Engine** | High-frequency counters | Views, likes, engagement | Fire-and-forget |
| **Vectorize** (Phase 2) | Semantic search | Video embeddings | Async indexing |

### Why This Architecture?

1. **D1**: Handles filtered queries, sorting, pagination (replaces "fetch all, filter in memory")
2. **Analytics Engine**: Handles high-write-volume counters without D1 write limits (~1000/sec)
3. **Vectorize**: Enables AI-powered search/recommendations without external services
4. **R2**: Remains the authoritative source for all entity data

### Data Flow - API Request (Read Path)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API REQUEST                                  │
│         GET /channels/:id/videos?sort=popular&limit=20              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. QUERY D1 (fast, indexed)                                        │
│     SELECT id FROM videos_index                                      │
│     WHERE channelId = ? AND isDeleted = 0 AND isHidden = 0          │
│     ORDER BY views DESC LIMIT 20                                     │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. FETCH FROM R2 (parallel, by ID)                                 │
│     Get full video objects for the 20 IDs                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. QUERY ANALYTICS ENGINE (optional, for real-time counts)         │
│     Get current views, likes, comments for the 20 videos             │
│     (Only if real-time precision needed)                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                           RESPONSE
```

### Data Flow - Write Path (Create/Update)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Create API    │────►│    R2 Bucket    │────►│    D1 Index     │
│   (api-videos)  │     │ (source of truth)│     │ (metadata sync) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │                                               ▼
        │                                      ┌─────────────────┐
        └─────────────────────────────────────►│   Vectorize     │
                                               │  (embeddings)   │
                                               └─────────────────┘
```

### Data Flow - Event Processing (Queue Batch)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    QUEUE BATCH (up to 100 messages)                  │
│                 (Messages are TRIGGERS, not data)                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. WRITE RAW MESSAGES TO R2 (existing behavior)                    │
│     Store each message as JSON for audit trail                       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. GROUP MESSAGES BY TYPE                                          │
│     videoViews: [{videoId: 'a'}, {videoId: 'a'}, {videoId: 'b'}]   │
│     videoLikes: [{videoId: 'c', action: 'like'}]                   │
│     subscriptions: [{channelId: 'x', action: 'subscribe'}]         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│ 3a. HIGH-FREQUENCY │ │ 3b. RELATIONSHIP  │ │ 3c. METADATA      │
│ COUNTERS           │ │ DATA              │ │ CHANGES           │
│                    │ │                    │ │                    │
│ Analytics Engine   │ │ Read from R2,     │ │ Sync to D1        │
│ (fire-and-forget)  │ │ aggregate counts, │ │ (visibility,      │
│                    │ │ batch write to D1 │ │  category, etc.)  │
│ - views            │ │                    │ │                    │
│ - impressions      │ │ - likes_count     │ │ - isDeleted       │
│ - watch_time       │ │ - comments_count  │ │ - isHidden        │
│                    │ │ - subscribers     │ │ - category        │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

## D1 Schema Design

### Database Name

```
al-ummah-now-index
```

### Tables

```sql
-- ============================================
-- Videos Index Table
-- ============================================
CREATE TABLE IF NOT EXISTS videos_index (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  user_id TEXT NOT NULL,

  -- Visibility flags (indexed for filtering)
  is_public INTEGER DEFAULT 1,      -- SQLite: 1=true, 0=false
  is_deleted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  is_live INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,

  -- Engagement metrics (updated by processor)
  views INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  dislikes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,

  -- Categorization
  category TEXT,

  -- Timestamps
  date_created TEXT NOT NULL,       -- ISO 8601
  date_modified TEXT NOT NULL,
  published_at TEXT,

  -- Scheduling
  scheduled_publish_date TEXT,
  scheduled_publish_status TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos_index(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos_index(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos_index(is_deleted, is_hidden, is_public);
CREATE INDEX IF NOT EXISTS idx_videos_date ON videos_index(date_created DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos_index(views DESC);
CREATE INDEX IF NOT EXISTS idx_videos_likes ON videos_index(likes_count DESC);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos_index(category);
CREATE INDEX IF NOT EXISTS idx_videos_live ON videos_index(is_live) WHERE is_live = 1;
CREATE INDEX IF NOT EXISTS idx_videos_featured ON videos_index(is_featured) WHERE is_featured = 1;
CREATE INDEX IF NOT EXISTS idx_videos_scheduled ON videos_index(scheduled_publish_status, scheduled_publish_date);

-- ============================================
-- Channels Index Table
-- ============================================
CREATE TABLE IF NOT EXISTS channels_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Visibility flags
  is_private INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  is_main INTEGER DEFAULT 0,

  -- Stats (updated by processor)
  subscribers_count INTEGER DEFAULT 0,
  videos_count INTEGER DEFAULT 0,
  shorts_count INTEGER DEFAULT 0,
  live_streams_count INTEGER DEFAULT 0,
  playlists_count INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,

  -- Categorization
  category TEXT,

  -- Timestamps
  date_created TEXT NOT NULL,
  date_modified TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_channels_user ON channels_index(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_visibility ON channels_index(is_deleted, is_hidden, is_private);
CREATE INDEX IF NOT EXISTS idx_channels_date ON channels_index(date_created DESC);
CREATE INDEX IF NOT EXISTS idx_channels_subscribers ON channels_index(subscribers_count DESC);
CREATE INDEX IF NOT EXISTS idx_channels_verified ON channels_index(is_verified) WHERE is_verified = 1;
CREATE INDEX IF NOT EXISTS idx_channels_main ON channels_index(user_id, is_main) WHERE is_main = 1;

-- ============================================
-- Playlists Index Table
-- ============================================
CREATE TABLE IF NOT EXISTS playlists_index (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  user_id TEXT NOT NULL,

  -- Visibility flags
  is_public INTEGER DEFAULT 1,
  is_deleted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,

  -- Stats
  videos_count INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,  -- seconds
  views_count INTEGER DEFAULT 0,

  -- Timestamps
  date_created TEXT NOT NULL,
  date_modified TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_playlists_channel ON playlists_index(channel_id);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists_index(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_visibility ON playlists_index(is_deleted, is_hidden, is_public);
CREATE INDEX IF NOT EXISTS idx_playlists_date ON playlists_index(date_created DESC);

-- ============================================
-- Channel Sections Index Table
-- ============================================
CREATE TABLE IF NOT EXISTS channel_sections_index (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- Section config
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  style TEXT,

  -- Visibility flags
  is_deleted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,

  -- Timestamps
  date_created TEXT NOT NULL,
  date_modified TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sections_channel ON channel_sections_index(channel_id);
CREATE INDEX IF NOT EXISTS idx_sections_position ON channel_sections_index(channel_id, position);
CREATE INDEX IF NOT EXISTS idx_sections_visibility ON channel_sections_index(is_deleted, is_hidden);

-- ============================================
-- Community Posts Index Table
-- ============================================
CREATE TABLE IF NOT EXISTS community_posts_index (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- Post config
  type TEXT NOT NULL,           -- text, image, poll, quiz, video, gif
  status TEXT NOT NULL,         -- published, scheduled, draft, deleted
  visibility TEXT NOT NULL,     -- public, subscribers, members

  -- Visibility flags
  is_deleted INTEGER DEFAULT 0,
  is_hidden INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  comments_enabled INTEGER DEFAULT 1,

  -- Stats
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT,
  scheduled_at TEXT,
  expires_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posts_channel ON community_posts_index(channel_id);
CREATE INDEX IF NOT EXISTS idx_posts_user ON community_posts_index(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON community_posts_index(is_deleted, is_hidden, status);
CREATE INDEX IF NOT EXISTS idx_posts_date ON community_posts_index(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type ON community_posts_index(type);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON community_posts_index(channel_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON community_posts_index(status, scheduled_at) WHERE status = 'scheduled';

-- ============================================
-- Comments Index Table (optional, for later)
-- ============================================
-- CREATE TABLE IF NOT EXISTS comments_index (
--   id TEXT PRIMARY KEY,
--   video_id TEXT,
--   post_id TEXT,
--   user_id TEXT NOT NULL,
--   parent_id TEXT,
--
--   is_deleted INTEGER DEFAULT 0,
--   is_hidden INTEGER DEFAULT 0,
--   is_pinned INTEGER DEFAULT 0,
--   is_hearted INTEGER DEFAULT 0,
--
--   likes_count INTEGER DEFAULT 0,
--   replies_count INTEGER DEFAULT 0,
--
--   created_at TEXT NOT NULL,
--   updated_at TEXT
-- );
```

## Wrangler Configuration Changes

### API Videos (`apps/api-videos/wrangler.jsonc`)

Add D1 binding:

```jsonc
{
  // ... existing config ...

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "al-ummah-now-index",
      "database_id": "PRODUCTION_DATABASE_ID",  // Get from wrangler d1 create
      "preview_database_id": "PREVIEW_DATABASE_ID"
    }
  ]
}
```

### Processor (`apps/processor/wrangler.jsonc`)

Add D1 binding:

```jsonc
{
  // ... existing config ...

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "al-ummah-now-index",
      "database_id": "PRODUCTION_DATABASE_ID",
      "preview_database_id": "PREVIEW_DATABASE_ID"
    }
  ]
}
```

### Create D1 Database

```bash
# Production
wrangler d1 create al-ummah-now-index

# Preview (for local dev)
wrangler d1 create al-ummah-now-index-preview
```

## Analytics Engine Configuration

### Overview

Analytics Engine is used for high-frequency counters that would overwhelm D1's write limits:
- Video views (potentially millions/day)
- Watch time tracking
- Impression counts
- Engagement metrics (scrolls, hovers, etc.)

### Wrangler Configuration

**Add to both `api-videos` and `processor` wrangler configs:**

```jsonc
{
  "analytics_engine_datasets": [
    {
      "binding": "ANALYTICS",
      "dataset": "al_ummah_video_metrics"
    }
  ]
}
```

### Analytics Engine Schema

```typescript
// Data points written to Analytics Engine
interface VideoMetricDataPoint {
  // Indexes (queryable, up to 20)
  indexes: {
    idx1: string;  // videoId
    idx2: string;  // channelId
    idx3: string;  // userId (optional)
    idx4: string;  // eventType (view, watchTime, impression)
  };

  // Blobs (labels, up to 20)
  blobs: {
    blob1: string;  // country
    blob2: string;  // device_type
    blob3: string;  // quality (720p, 1080p, etc.)
  };

  // Doubles (numeric values, up to 20)
  doubles: {
    double1: number;  // duration_seconds (for watchTime events)
    double2: number;  // value (1 for counts, actual value for metrics)
  };
}
```

### Writing to Analytics Engine (Processor)

```typescript
// Fire-and-forget writes - no await needed, no errors thrown
env.ANALYTICS.writeDataPoint({
  indexes: [videoId, channelId, userId || '', 'view'],
  blobs: [country, deviceType, ''],
  doubles: [0, 1],  // 1 view
});

// Watch time tracking
env.ANALYTICS.writeDataPoint({
  indexes: [videoId, channelId, userId || '', 'watchTime'],
  blobs: [country, deviceType, quality],
  doubles: [durationSeconds, durationSeconds],
});
```

### Querying Analytics Engine (API)

```typescript
// Get total views for a video (last 7 days)
const query = `
  SELECT
    idx1 as video_id,
    SUM(double2) as total_views
  FROM al_ummah_video_metrics
  WHERE idx4 = 'view'
    AND idx1 = '${videoId}'
    AND timestamp > NOW() - INTERVAL '7' DAY
  GROUP BY idx1
`;

// Get views per day for a channel
const query = `
  SELECT
    toDate(timestamp) as date,
    SUM(double2) as daily_views
  FROM al_ummah_video_metrics
  WHERE idx4 = 'view'
    AND idx2 = '${channelId}'
    AND timestamp > NOW() - INTERVAL '30' DAY
  GROUP BY date
  ORDER BY date DESC
`;
```

### Syncing Analytics to D1

For sorting by views in D1, periodically sync aggregated counts:

```typescript
// Run every hour via Cron Trigger
async scheduled(event: ScheduledEvent, env: Env) {
  // Get top-changing videos from Analytics Engine
  const results = await env.ANALYTICS.query(`
    SELECT idx1 as video_id, SUM(double2) as new_views
    FROM al_ummah_video_metrics
    WHERE idx4 = 'view'
      AND timestamp > NOW() - INTERVAL '1' HOUR
    GROUP BY idx1
    HAVING new_views > 0
    LIMIT 1000
  `);

  // Batch update D1
  const updates = results.data.map(row =>
    env.DB.prepare('UPDATE videos_index SET views = views + ? WHERE id = ?')
      .bind(row.new_views, row.video_id)
  );

  await env.DB.batch(updates);
}
```

## Vectorize Configuration (Phase 2)

### Overview

Vectorize enables semantic search and AI-powered recommendations:
- Search videos by meaning, not just keywords
- "Videos like this" recommendations
- Content-based filtering for personalization

### Wrangler Configuration

```jsonc
{
  "vectorize": {
    "binding": "VECTORIZE",
    "index_name": "al-ummah-video-embeddings",
    "metric": "cosine",
    "dimensions": 1536  // OpenAI text-embedding-3-small
  }
}
```

### Vectorize Schema

```typescript
interface VideoEmbedding {
  id: string;           // videoId
  values: number[];     // 1536-dimensional vector
  metadata: {
    title: string;
    channelId: string;
    category: string;
    language: string;
    dateCreated: string;
  };
}
```

### Generating Embeddings

```typescript
// Using Workers AI for embeddings
async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: text,
  });
  return response.data[0];
}

// Index a video
async function indexVideo(env: Env, video: Video): Promise<void> {
  const text = `${video.title} ${video.description} ${video.tags.join(' ')}`;
  const embedding = await generateEmbedding(env, text);

  await env.VECTORIZE.insert([{
    id: video.id,
    values: embedding,
    metadata: {
      title: video.title,
      channelId: video.channelId,
      category: video.category,
      language: video.language,
      dateCreated: video.dateCreated,
    },
  }]);
}
```

### Semantic Search API

```typescript
// Search endpoint
async function semanticSearch(
  env: Env,
  query: string,
  filters?: { channelId?: string; category?: string },
  limit: number = 10
): Promise<string[]> {
  const queryEmbedding = await generateEmbedding(env, query);

  const results = await env.VECTORIZE.query(queryEmbedding, {
    topK: limit,
    filter: filters ? {
      channelId: filters.channelId,
      category: filters.category,
    } : undefined,
  });

  return results.matches.map(m => m.id);
}

// "More like this" recommendations
async function similarVideos(
  env: Env,
  videoId: string,
  limit: number = 10
): Promise<string[]> {
  const results = await env.VECTORIZE.query({
    id: videoId,  // Query by existing vector ID
  }, {
    topK: limit + 1,  // +1 to exclude self
  });

  return results.matches
    .filter(m => m.id !== videoId)
    .map(m => m.id);
}
```

## File-by-File Implementation Plan

### Phase 1: Infrastructure Setup (Week 1)

#### 1.1 Create D1 Database and Schema

**New file:** `apps/api-videos/migrations/0001_initial_schema.sql`

```sql
-- Contains all CREATE TABLE and CREATE INDEX statements from above
```

**Commands:**
```bash
# Apply migrations
wrangler d1 migrations apply al-ummah-now-index --local  # Local testing
wrangler d1 migrations apply al-ummah-now-index          # Production
```

#### 1.2 Update Types

**Modify:** `packages/shared-types/src/index.ts`

```typescript
// Add D1 index types
export * from './d1-index';
```

**New file:** `packages/shared-types/src/d1-index.ts`

```typescript
// D1 Index Row Types (matching SQL schema)
export interface VideoIndexRow {
  id: string;
  channel_id: string | null;
  user_id: string;
  is_public: number; // 0 or 1
  is_deleted: number;
  is_hidden: number;
  is_live: number;
  is_featured: number;
  views: number;
  likes_count: number;
  dislikes_count: number;
  comments_count: number;
  category: string | null;
  date_created: string;
  date_modified: string;
  published_at: string | null;
  scheduled_publish_date: string | null;
  scheduled_publish_status: string | null;
}

export interface ChannelIndexRow {
  id: string;
  user_id: string;
  is_private: number;
  is_deleted: number;
  is_hidden: number;
  is_verified: number;
  is_main: number;
  subscribers_count: number;
  videos_count: number;
  shorts_count: number;
  live_streams_count: number;
  playlists_count: number;
  total_views: number;
  category: string | null;
  date_created: string;
  date_modified: string;
}

export interface PlaylistIndexRow {
  id: string;
  channel_id: string | null;
  user_id: string;
  is_public: number;
  is_deleted: number;
  is_hidden: number;
  videos_count: number;
  total_duration: number;
  views_count: number;
  date_created: string;
  date_modified: string;
}

export interface ChannelSectionIndexRow {
  id: string;
  channel_id: string;
  user_id: string;
  type: string;
  position: number;
  style: string | null;
  is_deleted: number;
  is_hidden: number;
  date_created: string;
  date_modified: string;
}

export interface CommunityPostIndexRow {
  id: string;
  channel_id: string;
  user_id: string;
  type: string;
  status: string;
  visibility: string;
  is_deleted: number;
  is_hidden: number;
  pinned: number;
  comments_enabled: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  created_at: string;
  updated_at: string | null;
  scheduled_at: string | null;
  expires_at: string | null;
}
```

#### 1.3 Create D1 Repository Library

**New file:** `apps/api-videos/src/lib/d1Repo.ts`

```typescript
import { D1Database } from '@cloudflare/workers-types';
import { logger } from './logger';

export interface D1QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface D1ListResult<T> {
  items: T[];
  total: number;
  hasNext: boolean;
}

/**
 * Generic D1 Repository for index operations
 */
export class D1Repository<T extends Record<string, unknown>> {
  constructor(
    private db: D1Database,
    private tableName: string
  ) {}

  /**
   * Insert a new row
   */
  async insert(data: T): Promise<void> {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(data);

    await this.db
      .prepare(`INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`)
      .bind(...values)
      .run();
  }

  /**
   * Update an existing row by ID
   */
  async update(id: string, data: Partial<T>): Promise<void> {
    const entries = Object.entries(data).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return;

    const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([_, v]) => v);

    await this.db
      .prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`)
      .bind(...values, id)
      .run();
  }

  /**
   * Delete a row by ID
   */
  async delete(id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .run();
  }

  /**
   * Find a single row by ID
   */
  async findById(id: string): Promise<T | null> {
    const result = await this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .bind(id)
      .first<T>();
    return result;
  }

  /**
   * List rows with filtering and pagination
   */
  async list(
    where: Record<string, unknown> = {},
    options: D1QueryOptions = {}
  ): Promise<D1ListResult<T>> {
    const { limit = 20, offset = 0, orderBy = 'date_created', orderDirection = 'DESC' } = options;

    // Build WHERE clause
    const whereEntries = Object.entries(where).filter(([_, v]) => v !== undefined);
    const whereClause = whereEntries.length > 0
      ? `WHERE ${whereEntries.map(([k]) => `${k} = ?`).join(' AND ')}`
      : '';
    const whereValues = whereEntries.map(([_, v]) => v);

    // Count total
    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`)
      .bind(...whereValues)
      .first<{ count: number }>();
    const total = countResult?.count ?? 0;

    // Fetch page
    const query = `
      SELECT * FROM ${this.tableName}
      ${whereClause}
      ORDER BY ${orderBy} ${orderDirection}
      LIMIT ? OFFSET ?
    `;
    const result = await this.db
      .prepare(query)
      .bind(...whereValues, limit, offset)
      .all<T>();

    return {
      items: result.results ?? [],
      total,
      hasNext: offset + (result.results?.length ?? 0) < total,
    };
  }

  /**
   * Execute a raw query (for complex filters)
   */
  async query(sql: string, ...params: unknown[]): Promise<T[]> {
    const result = await this.db.prepare(sql).bind(...params).all<T>();
    return result.results ?? [];
  }

  /**
   * Execute a count query
   */
  async count(where: Record<string, unknown> = {}): Promise<number> {
    const whereEntries = Object.entries(where).filter(([_, v]) => v !== undefined);
    const whereClause = whereEntries.length > 0
      ? `WHERE ${whereEntries.map(([k]) => `${k} = ?`).join(' AND ')}`
      : '';
    const whereValues = whereEntries.map(([_, v]) => v);

    const result = await this.db
      .prepare(`SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`)
      .bind(...whereValues)
      .first<{ count: number }>();

    return result?.count ?? 0;
  }

  /**
   * Increment a counter column
   */
  async increment(id: string, column: string, amount: number = 1): Promise<void> {
    await this.db
      .prepare(`UPDATE ${this.tableName} SET ${column} = ${column} + ? WHERE id = ?`)
      .bind(amount, id)
      .run();
  }

  /**
   * Decrement a counter column (with floor at 0)
   */
  async decrement(id: string, column: string, amount: number = 1): Promise<void> {
    await this.db
      .prepare(`UPDATE ${this.tableName} SET ${column} = MAX(0, ${column} - ?) WHERE id = ?`)
      .bind(amount, id)
      .run();
  }

  /**
   * Batch insert rows
   */
  async batchInsert(rows: T[]): Promise<void> {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`
    );

    const batch = rows.map(row => stmt.bind(...Object.values(row)));
    await this.db.batch(batch);
  }
}
```

### Phase 2: Video Index Integration (Week 2)

#### 2.1 Create Video Index Service

**New file:** `apps/api-videos/src/lib/videoIndexService.ts`

```typescript
import { D1Database } from '@cloudflare/workers-types';
import { VideoIndexRow } from '@al-ummah/shared-types';
import { D1Repository } from './d1Repo';
import { VideoObject } from './model/video';

export interface VideoListQuery {
  channelId?: string;
  userId?: string;
  isPublic?: boolean;
  isLive?: boolean;
  isFeatured?: boolean;
  category?: string;
  excludeDeleted?: boolean;
  excludeHidden?: boolean;
}

export interface VideoListOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'date' | 'views' | 'likes' | 'title';
  sortDirection?: 'ASC' | 'DESC';
}

export class VideoIndexService {
  private repo: D1Repository<VideoIndexRow>;

  constructor(db: D1Database) {
    this.repo = new D1Repository<VideoIndexRow>(db, 'videos_index');
  }

  /**
   * Sync a video to the D1 index
   */
  async upsert(video: VideoObject): Promise<void> {
    const row: VideoIndexRow = {
      id: video.id,
      channel_id: video.channelId ?? null,
      user_id: video.userId,
      is_public: video.isPublic === false ? 0 : 1,
      is_deleted: video.isDeleted ? 1 : 0,
      is_hidden: video.isHidden ? 1 : 0,
      is_live: video.isLive ? 1 : 0,
      is_featured: video.isFeatured ? 1 : 0,
      views: video.views ?? 0,
      likes_count: video.likesCount ?? video.likes?.length ?? 0,
      dislikes_count: video.dislikesCount ?? video.dislikes?.length ?? 0,
      comments_count: video.commentsCount ?? video.comments?.length ?? 0,
      category: video.category ?? null,
      date_created: video.dateCreated,
      date_modified: video.dateModified,
      published_at: video.publishedAt ?? null,
      scheduled_publish_date: video.scheduledPublishDate ?? null,
      scheduled_publish_status: video.scheduledPublishStatus ?? null,
    };

    const existing = await this.repo.findById(video.id);
    if (existing) {
      await this.repo.update(video.id, row);
    } else {
      await this.repo.insert(row);
    }
  }

  /**
   * Remove a video from the D1 index
   */
  async delete(videoId: string): Promise<void> {
    await this.repo.delete(videoId);
  }

  /**
   * Mark a video as deleted (soft delete)
   */
  async markDeleted(videoId: string): Promise<void> {
    await this.repo.update(videoId, { is_deleted: 1 } as Partial<VideoIndexRow>);
  }

  /**
   * List video IDs with filtering and pagination
   */
  async listIds(
    query: VideoListQuery,
    options: VideoListOptions = {}
  ): Promise<{ ids: string[]; total: number; hasNext: boolean }> {
    const { limit = 20, offset = 0, sortBy = 'date', sortDirection = 'DESC' } = options;
    const {
      channelId,
      userId,
      isPublic,
      isLive,
      isFeatured,
      category,
      excludeDeleted = true,
      excludeHidden = true,
    } = query;

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (excludeDeleted) {
      conditions.push('is_deleted = 0');
    }
    if (excludeHidden) {
      conditions.push('is_hidden = 0');
    }
    if (channelId) {
      conditions.push('channel_id = ?');
      params.push(channelId);
    }
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    if (isPublic !== undefined) {
      conditions.push('is_public = ?');
      params.push(isPublic ? 1 : 0);
    }
    if (isLive !== undefined) {
      conditions.push('is_live = ?');
      params.push(isLive ? 1 : 0);
    }
    if (isFeatured !== undefined) {
      conditions.push('is_featured = ?');
      params.push(isFeatured ? 1 : 0);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Map sort field
    const sortColumn = {
      date: 'date_created',
      views: 'views',
      likes: 'likes_count',
      title: 'id', // title not stored, fallback to id
    }[sortBy] ?? 'date_created';

    // Get total count
    const countSql = `SELECT COUNT(*) as count FROM videos_index ${whereClause}`;
    // Execute count query...

    // Get IDs
    const sql = `
      SELECT id FROM videos_index
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const results = await this.repo.query(sql, ...params);
    const ids = results.map(r => r.id);

    // For total, execute separate count
    const total = await this.countWithConditions(conditions, params.slice(0, -2));

    return {
      ids,
      total,
      hasNext: offset + ids.length < total,
    };
  }

  private async countWithConditions(conditions: string[], params: unknown[]): Promise<number> {
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.repo.query(
      `SELECT COUNT(*) as count FROM videos_index ${whereClause}`,
      ...params
    );
    return (result[0] as any)?.count ?? 0;
  }

  /**
   * Increment view count
   */
  async incrementViews(videoId: string): Promise<void> {
    await this.repo.increment(videoId, 'views');
  }

  /**
   * Update engagement counts
   */
  async updateEngagement(
    videoId: string,
    counts: { likes?: number; dislikes?: number; comments?: number }
  ): Promise<void> {
    const updates: Partial<VideoIndexRow> = {};
    if (counts.likes !== undefined) updates.likes_count = counts.likes;
    if (counts.dislikes !== undefined) updates.dislikes_count = counts.dislikes;
    if (counts.comments !== undefined) updates.comments_count = counts.comments;

    if (Object.keys(updates).length > 0) {
      await this.repo.update(videoId, updates);
    }
  }

  /**
   * Increment like count
   */
  async incrementLikes(videoId: string): Promise<void> {
    await this.repo.increment(videoId, 'likes_count');
  }

  /**
   * Decrement like count
   */
  async decrementLikes(videoId: string): Promise<void> {
    await this.repo.decrement(videoId, 'likes_count');
  }

  /**
   * Increment comment count
   */
  async incrementComments(videoId: string): Promise<void> {
    await this.repo.increment(videoId, 'comments_count');
  }

  /**
   * Decrement comment count
   */
  async decrementComments(videoId: string): Promise<void> {
    await this.repo.decrement(videoId, 'comments_count');
  }
}
```

#### 2.2 Update Video List Endpoint

**Modify:** `apps/api-videos/src/endpoints/video/videoList.ts`

```typescript
// Add D1 integration (backwards compatible)
import { VideoIndexService } from '../../lib/videoIndexService';

export class VideosList extends OpenAPIRoute {
  schema = {
    // ... existing schema ...
  };

  async handle(c) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { limit, cursor, sort, filter, channelId: queryChannelId, category } = request.query;
    const { channelId, userId } = request.headers;

    const filterChannelId = queryChannelId || channelId;
    const bucket = c.env.videos;
    const db = c.env.DB;

    // Use D1 if available, fallback to R2-only
    if (db) {
      return this.handleWithD1(c, {
        limit,
        offset: cursor ? parseInt(cursor, 10) : 0,
        sort,
        filter,
        channelId: filterChannelId,
        category,
        userId,
      });
    }

    // Fallback: Original R2-only implementation
    return this.handleWithR2Only(c, { limit, cursor, sort, filter, channelId: filterChannelId, category, userId });
  }

  private async handleWithD1(c: any, params: any): Promise<Response> {
    const videoIndex = new VideoIndexService(c.env.DB);
    const bucket = c.env.videos;

    // Build query
    const query: VideoListQuery = {
      channelId: params.channelId,
      excludeDeleted: true,
      excludeHidden: true,
    };

    // Apply filter
    if (params.filter === 'public') query.isPublic = true;
    if (params.filter === 'private') query.isPublic = false;
    if (params.filter === 'live') query.isLive = true;
    if (params.category) query.category = params.category;

    // Get IDs from D1
    const { ids, total, hasNext } = await videoIndex.listIds(query, {
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sort,
      sortDirection: 'DESC',
    });

    // Fetch full entities from R2
    const repository = new R2Repository<VideoType>(bucket);
    const videos = await Promise.all(
      ids.map(id => repository.getObject(id))
    );

    // Filter out nulls and apply privacy check
    const filteredVideos = videos.filter(video => {
      if (!video) return false;
      if (video.isPublic === false && video.userId !== params.userId) return false;
      return true;
    });

    // Transform to view models
    const transformToView = (video: VideoType) => ({
      ...video,
      channelName: '',
      channelAvatarUrl: undefined,
      likesCount: video.likes?.length || 0,
      dislikesCount: video.dislikes?.length || 0,
      commentsCount: video.comments?.length || 0,
    });

    return c.json({
      cursor: hasNext ? String(params.offset + params.limit) : '',
      limit: params.limit,
      total,
      data: filteredVideos.map(transformToView),
    });
  }

  private async handleWithR2Only(c: any, params: any): Promise<Response> {
    // ... existing R2-only implementation ...
  }
}
```

#### 2.3 Update Video Create Endpoint

**Modify:** `apps/api-videos/src/endpoints/video/videoCreate.ts`

Add D1 sync after R2 save:

```typescript
// After saving to R2
if (c.env.DB) {
  const videoIndex = new VideoIndexService(c.env.DB);
  await videoIndex.upsert(savedVideo);
}
```

#### 2.4 Update Video Update Endpoint

**Modify:** `apps/api-videos/src/endpoints/video/videoUpdate.ts`

Add D1 sync after R2 update:

```typescript
// After updating R2
if (c.env.DB) {
  const videoIndex = new VideoIndexService(c.env.DB);
  await videoIndex.upsert(updatedVideo);
}
```

#### 2.5 Update Video Delete Endpoint

**Modify:** `apps/api-videos/src/endpoints/video/videoDelete.ts`

Add D1 sync for soft delete:

```typescript
// After soft delete in R2
if (c.env.DB) {
  const videoIndex = new VideoIndexService(c.env.DB);
  await videoIndex.markDeleted(videoId);
}
```

### Phase 3: Processor D1 Updates (Week 3)

#### 3.1 Add D1 Type to Processor Environment

**Modify:** `apps/processor/src/types.ts`

```typescript
import { D1Database } from '@cloudflare/workers-types';

export interface QueueEnvironment {
  // ... existing ...
  DB: D1Database;
}
```

#### 3.2 Create Processor D1 Update Functions

**New file:** `apps/processor/src/lib/d1Updates.ts`

```typescript
import { D1Database } from '@cloudflare/workers-types';
import { logger } from './logger';

export class D1UpdateService {
  constructor(private db: D1Database) {}

  /**
   * Increment video view count
   */
  async incrementVideoViews(videoId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE videos_index SET views = views + 1 WHERE id = ?')
        .bind(videoId)
        .run();
    } catch (error) {
      logger.error('Failed to increment video views in D1', { videoId, error });
    }
  }

  /**
   * Increment video like count
   */
  async incrementVideoLikes(videoId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE videos_index SET likes_count = likes_count + 1 WHERE id = ?')
        .bind(videoId)
        .run();
    } catch (error) {
      logger.error('Failed to increment video likes in D1', { videoId, error });
    }
  }

  /**
   * Decrement video like count
   */
  async decrementVideoLikes(videoId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE videos_index SET likes_count = MAX(0, likes_count - 1) WHERE id = ?')
        .bind(videoId)
        .run();
    } catch (error) {
      logger.error('Failed to decrement video likes in D1', { videoId, error });
    }
  }

  /**
   * Increment video comment count
   */
  async incrementVideoComments(videoId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE videos_index SET comments_count = comments_count + 1 WHERE id = ?')
        .bind(videoId)
        .run();
    } catch (error) {
      logger.error('Failed to increment video comments in D1', { videoId, error });
    }
  }

  /**
   * Decrement video comment count
   */
  async decrementVideoComments(videoId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE videos_index SET comments_count = MAX(0, comments_count - 1) WHERE id = ?')
        .bind(videoId)
        .run();
    } catch (error) {
      logger.error('Failed to decrement video comments in D1', { videoId, error });
    }
  }

  /**
   * Increment channel subscriber count
   */
  async incrementChannelSubscribers(channelId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE channels_index SET subscribers_count = subscribers_count + 1 WHERE id = ?')
        .bind(channelId)
        .run();
    } catch (error) {
      logger.error('Failed to increment channel subscribers in D1', { channelId, error });
    }
  }

  /**
   * Decrement channel subscriber count
   */
  async decrementChannelSubscribers(channelId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE channels_index SET subscribers_count = MAX(0, subscribers_count - 1) WHERE id = ?')
        .bind(channelId)
        .run();
    } catch (error) {
      logger.error('Failed to decrement channel subscribers in D1', { channelId, error });
    }
  }

  /**
   * Increment channel video count
   */
  async incrementChannelVideos(channelId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE channels_index SET videos_count = videos_count + 1 WHERE id = ?')
        .bind(channelId)
        .run();
    } catch (error) {
      logger.error('Failed to increment channel videos in D1', { channelId, error });
    }
  }

  /**
   * Decrement channel video count
   */
  async decrementChannelVideos(channelId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE channels_index SET videos_count = MAX(0, videos_count - 1) WHERE id = ?')
        .bind(channelId)
        .run();
    } catch (error) {
      logger.error('Failed to decrement channel videos in D1', { channelId, error });
    }
  }

  /**
   * Increment community post likes
   */
  async incrementPostLikes(postId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE community_posts_index SET likes = likes + 1 WHERE id = ?')
        .bind(postId)
        .run();
    } catch (error) {
      logger.error('Failed to increment post likes in D1', { postId, error });
    }
  }

  /**
   * Decrement community post likes
   */
  async decrementPostLikes(postId: string): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE community_posts_index SET likes = MAX(0, likes - 1) WHERE id = ?')
        .bind(postId)
        .run();
    } catch (error) {
      logger.error('Failed to decrement post likes in D1', { postId, error });
    }
  }

  /**
   * Batch update counts (for efficiency)
   */
  async batchUpdateCounts(updates: Array<{
    table: string;
    id: string;
    column: string;
    delta: number;
  }>): Promise<void> {
    if (updates.length === 0) return;

    const statements = updates.map(({ table, id, column, delta }) => {
      const op = delta >= 0 ? '+' : '-';
      const amount = Math.abs(delta);
      return this.db
        .prepare(`UPDATE ${table} SET ${column} = MAX(0, ${column} ${op} ?) WHERE id = ?`)
        .bind(amount, id);
    });

    try {
      await this.db.batch(statements);
    } catch (error) {
      logger.error('Failed to batch update counts in D1', { updates, error });
    }
  }
}
```

#### 3.3 Update Message Processor

**Modify:** `apps/processor/src/messageProcessor.ts`

Add D1 updates to message handlers:

```typescript
import { D1UpdateService } from './lib/d1Updates';

export class MessageProcessor {
  private d1Service?: D1UpdateService;

  constructor(private logger: Logger) {}

  async processMessage(message: AlUmmahMessage, env: QueueEnvironment): Promise<ProcessingResult> {
    // Initialize D1 service if available
    if (env.DB && !this.d1Service) {
      this.d1Service = new D1UpdateService(env.DB);
    }

    // ... existing processing ...
  }

  private async processVideoMessage(type: MessageType, payload: any): Promise<void> {
    // ... existing R2 processing ...

    // Add D1 updates
    if (this.d1Service) {
      switch (type) {
        case MessageType.VideoView:
          await this.d1Service.incrementVideoViews(payload.videoId);
          break;
        case MessageType.VideoLike:
          await this.d1Service.incrementVideoLikes(payload.videoId);
          break;
        case MessageType.VideoUnlike:
          await this.d1Service.decrementVideoLikes(payload.videoId);
          break;
        case MessageType.CommentCreate:
          await this.d1Service.incrementVideoComments(payload.videoId);
          break;
        case MessageType.CommentDelete:
          await this.d1Service.decrementVideoComments(payload.videoId);
          break;
      }
    }
  }

  private async processSubscriptionMessage(type: MessageType, payload: any): Promise<void> {
    // ... existing processing ...

    // Add D1 updates
    if (this.d1Service) {
      switch (type) {
        case MessageType.Subscribe:
          await this.d1Service.incrementChannelSubscribers(payload.channelId);
          break;
        case MessageType.Unsubscribe:
          await this.d1Service.decrementChannelSubscribers(payload.channelId);
          break;
      }
    }
  }

  // Similar updates for other message types...
}
```

### Phase 4: Channel, Playlist, Section, Post Indexes (Week 4)

Follow the same pattern as Videos:

1. Create `ChannelIndexService`, `PlaylistIndexService`, `ChannelSectionIndexService`, `CommunityPostIndexService`
2. Update respective CRUD endpoints to sync D1
3. Update respective list endpoints to query D1

### Phase 5: Migration Script (Week 5)

#### 5.1 Create Migration Worker

**New file:** `apps/api-videos/src/scripts/migrate-to-d1.ts`

```typescript
import { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { VideoIndexRow, ChannelIndexRow } from '@al-ummah/shared-types';

interface MigrationEnv {
  DB: D1Database;
  videos: R2Bucket;
  channels: R2Bucket;
  playlists: R2Bucket;
  channel_sections: R2Bucket;
  community_posts: R2Bucket;
}

export async function migrateVideosToD1(env: MigrationEnv): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = [];
  let migrated = 0;
  let cursor: string | undefined;

  do {
    // List objects from R2
    const list = await env.videos.list({ limit: 100, cursor });
    cursor = list.truncated ? list.cursor : undefined;

    // Prepare batch insert
    const rows: VideoIndexRow[] = [];

    for (const obj of list.objects) {
      try {
        const data = await env.videos.get(obj.key);
        if (!data) continue;

        const video = await data.json() as any;

        rows.push({
          id: video.id,
          channel_id: video.channelId ?? null,
          user_id: video.userId,
          is_public: video.isPublic === false ? 0 : 1,
          is_deleted: video.isDeleted ? 1 : 0,
          is_hidden: video.isHidden ? 1 : 0,
          is_live: video.isLive ? 1 : 0,
          is_featured: video.isFeatured ? 1 : 0,
          views: video.views ?? 0,
          likes_count: video.likesCount ?? video.likes?.length ?? 0,
          dislikes_count: video.dislikesCount ?? video.dislikes?.length ?? 0,
          comments_count: video.commentsCount ?? video.comments?.length ?? 0,
          category: video.category ?? null,
          date_created: video.dateCreated,
          date_modified: video.dateModified,
          published_at: video.publishedAt ?? null,
          scheduled_publish_date: video.scheduledPublishDate ?? null,
          scheduled_publish_status: video.scheduledPublishStatus ?? null,
        });
      } catch (error) {
        errors.push(`Video ${obj.key}: ${error}`);
      }
    }

    // Batch insert to D1
    if (rows.length > 0) {
      const stmt = env.DB.prepare(`
        INSERT OR REPLACE INTO videos_index (
          id, channel_id, user_id, is_public, is_deleted, is_hidden, is_live, is_featured,
          views, likes_count, dislikes_count, comments_count, category,
          date_created, date_modified, published_at, scheduled_publish_date, scheduled_publish_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batch = rows.map(row => stmt.bind(
        row.id, row.channel_id, row.user_id, row.is_public, row.is_deleted, row.is_hidden,
        row.is_live, row.is_featured, row.views, row.likes_count, row.dislikes_count,
        row.comments_count, row.category, row.date_created, row.date_modified,
        row.published_at, row.scheduled_publish_date, row.scheduled_publish_status
      ));

      await env.DB.batch(batch);
      migrated += rows.length;
    }
  } while (cursor);

  return { migrated, errors };
}

// Similar functions for channels, playlists, sections, posts...

export async function runFullMigration(env: MigrationEnv): Promise<void> {
  console.log('Starting D1 migration...');

  const videoResult = await migrateVideosToD1(env);
  console.log(`Videos: ${videoResult.migrated} migrated, ${videoResult.errors.length} errors`);

  // Run other migrations...

  console.log('Migration complete!');
}
```

#### 5.2 Create Migration Endpoint (Admin Only)

**New file:** `apps/api-videos/src/endpoints/admin/migrateTD1.ts`

```typescript
export class MigrateToD1 extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Migrate R2 data to D1 index (admin only)',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Migration completed' },
      401: { description: 'Unauthorized' },
      500: { description: 'Migration failed' },
    },
  };

  async handle(c) {
    // Verify admin role
    const auth = c.get('auth');
    if (!auth?.isAdmin) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const result = await runFullMigration({
        DB: c.env.DB,
        videos: c.env.videos,
        channels: c.env.channels,
        playlists: c.env.playlists,
        channel_sections: c.env.channel_sections,
        community_posts: c.env.community_posts,
      });

      return c.json({ success: true, result });
    } catch (error) {
      return c.json({ error: error.message }, 500);
    }
  }
}
```

## Consequences

### Positive

**D1 (Queryable Index):**
1. **Performance**: O(1) filtering instead of O(n) full scan
2. **Scalability**: D1 handles millions of rows efficiently
3. **Pagination**: True cursor-based pagination with accurate counts
4. **Sorting**: SQL ORDER BY with indexes (instant)
5. **Filtering**: Complex WHERE clauses supported

**Analytics Engine:**
6. **Unlimited writes**: No write limits for views/watch time (unlike D1's ~1000/sec)
7. **Fire-and-forget**: Non-blocking writes, no await needed
8. **Built-in aggregation**: SUM, AVG, COUNT at query time
9. **Time-series native**: Automatic timestamp indexing

**Vectorize:**
10. **Semantic search**: Find videos by meaning, not just keywords
11. **Recommendations**: "More like this" without external ML services
12. **Cloudflare-native**: No external AI/ML infrastructure needed

**Overall:**
13. **Cost reduction**: Reduced R2 reads (major cost factor)
14. **Cloudflare ecosystem**: All services from same provider (edge-native)

### Negative

1. **Multi-service complexity**: 4 data stores to manage (R2, D1, Analytics Engine, Vectorize)
2. **Eventual consistency**: Analytics Engine has ~15 minute delay for queries
3. **D1 sync lag**: Hourly cron may show slightly stale view counts in listings
4. **Migration effort**: Need to backfill all existing data
5. **Learning curve**: Team needs to understand 4 different APIs

### Mitigations

1. **Multi-service**: Clear separation of concerns; each service has one job
2. **Eventual consistency**: Acceptable for analytics; real-time not required
3. **D1 sync lag**: Use Analytics Engine directly for real-time dashboards
4. **Migration**: Automated scripts with progress tracking
5. **Learning**: All Cloudflare services have similar patterns, good docs

## Alternatives Considered

### For Queryable Indexes

#### 1. Algolia / Meilisearch

**Rejected because:**
- External service (latency, cost)
- Not Cloudflare-native
- Overkill for simple filtering

#### 2. Cloudflare KV with Secondary Keys

**Rejected because:**
- No complex queries (WHERE, ORDER BY)
- Would need multiple keys per entity
- Still requires full scans for some queries

#### 3. R2 with JSON Index Files

**Rejected because:**
- Already using this pattern (community posts)
- Doesn't scale well
- Still requires reading index + all entities

#### 4. External Database (PlanetScale, Neon)

**Rejected because:**
- External latency (not edge)
- Additional cost
- Not Cloudflare-native

### For High-Frequency Counters

#### 5. D1 for All Counters

**Rejected because:**
- ~1000 writes/second limit
- Video views could exceed this easily with viral content
- Would require batching complexity

#### 6. KV with Atomic Counters

**Rejected because:**
- KV has eventual consistency (up to 60s)
- No SQL aggregation capabilities
- Can't query by time range

#### 7. External Analytics (Mixpanel, Amplitude)

**Rejected because:**
- External latency and cost
- Data leaves Cloudflare network
- Additional integration complexity

### For AI Search

#### 8. External Vector DB (Pinecone, Weaviate)

**Rejected because:**
- External service (latency, cost)
- Requires data transfer to external system
- Not Cloudflare-native

#### 9. Simple Keyword Search Only

**Rejected because:**
- Poor user experience for discovery
- Misses semantic matches
- No recommendation capability

## Rollback Strategy

### Phase 1: Feature Flag Rollback

Add feature flag to toggle D1:

```typescript
const useD1 = c.env.FEATURE_D1_INDEX === 'true' && c.env.DB;
```

Disable by setting `FEATURE_D1_INDEX=false`.

### Phase 2: Full Rollback

If critical issues:

1. Remove D1 bindings from wrangler configs
2. Revert endpoint code to R2-only
3. D1 database can be dropped or kept for reference

### Data Recovery

R2 remains source of truth. D1 can be repopulated from R2 at any time using migration script.

## Testing Plan

### Unit Tests

1. D1Repository CRUD operations
2. VideoIndexService query building
3. Migration script correctness

### Integration Tests

1. Create video -> verify D1 row created
2. Update video -> verify D1 row updated
3. Delete video -> verify D1 row marked deleted
4. List videos -> verify D1 query returns correct IDs
5. Queue events -> verify D1 counts updated

### Load Tests

1. List 1000 videos with filter -> compare R2 vs D1 latency
2. Concurrent writes -> verify no data loss
3. Large migration -> verify batch processing works

### E2E Tests

1. Full user flow: create video, list, search, delete
2. Verify Swagger UI works with D1-backed endpoints
3. Verify no regression in web app

## Implementation Notes

### D1 Limitations

- Max 25GB per database
- ~1000 writes/second (batching helps)
- No stored procedures
- Limited concurrent connections

### Performance Tips

1. Use batch inserts for migration
2. Keep indexes minimal but effective
3. Avoid SELECT * in queries
4. Use LIMIT/OFFSET for pagination (not cursor in D1)

### Monitoring

Add metrics for:
- D1 query latency (p50, p95, p99)
- D1 write success rate
- R2 vs D1 count discrepancies
- Migration progress

## Timeline

### Track 1: D1 Index Layer (Core)

| Phase | Deliverables |
|-------|--------------|
| 1.1 | D1 setup, schema migration, types, d1Repo library |
| 1.2 | Video index integration (create/update/delete/list) |
| 1.3 | Channel, Playlist, Section, Post indexes |
| 1.4 | Processor D1 batch updates |
| 1.5 | Migration script, backfill existing data |
| 1.6 | Testing, production rollout, monitoring |

### Track 2: Analytics Engine (High-Frequency Counters)

| Phase | Deliverables |
|-------|--------------|
| 2.1 | Analytics Engine binding configuration |
| 2.2 | Processor writes for views/watchTime/impressions |
| 2.3 | API queries for analytics dashboard |
| 2.4 | Cron job for D1 sync (hourly aggregation) |
| 2.5 | Testing, production rollout |

### Track 3: Vectorize (AI Search - Phase 2)

| Phase | Deliverables |
|-------|--------------|
| 3.1 | Vectorize binding, Workers AI embedding setup |
| 3.2 | Index video on create/update |
| 3.3 | Semantic search endpoint |
| 3.4 | Similar videos recommendation endpoint |
| 3.5 | Backfill existing videos |
| 3.6 | Testing, production rollout |

## References

### D1 (Queryable Index)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [D1 SQL Compatibility](https://developers.cloudflare.com/d1/platform/sql-compat/)
- [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [SQLite Index Best Practices](https://www.sqlite.org/queryplanner.html)

### Analytics Engine (High-Frequency Counters)
- [Analytics Engine Documentation](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)
- [Analytics Engine Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- [Writing Data Points](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)

### Vectorize (AI Search)
- [Vectorize Documentation](https://developers.cloudflare.com/vectorize/)
- [Vectorize Quickstart](https://developers.cloudflare.com/vectorize/get-started/)
- [Workers AI Text Embeddings](https://developers.cloudflare.com/workers-ai/models/text-embeddings/)
- [Vectorize with Workers AI Tutorial](https://developers.cloudflare.com/vectorize/tutorials/workers-ai-rag/)

### Queue Batch Processing
- [Queue Consumer Configuration](https://developers.cloudflare.com/queues/configuration/consumer/)
- [max_batch_size](https://developers.cloudflare.com/queues/configuration/consumer/#max-batch-size) - up to 100 messages
- [max_batch_timeout](https://developers.cloudflare.com/queues/configuration/consumer/#max-batch-timeout) - up to 60 seconds

### Transcription & AI Search Research
- [Transcription & AI Search Architecture](../research/transcription-and-search-architecture.md) - Detailed vendor comparison, pricing analysis, and implementation roadmap for 30TB scale video platform
