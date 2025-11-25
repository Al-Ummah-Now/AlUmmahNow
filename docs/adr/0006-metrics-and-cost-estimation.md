# ADR-0006: Metrics Collection and Cost Estimation System

## Status

**Proposed** | Date: 2025-11-25

## Context

The Al Ummah Now platform operates across multiple cloud providers (Cloudflare, Bunny.net, RunPod) with no unified cost visibility. Providers do not offer real-time cost APIs - we must track usage metrics ourselves and calculate costs using rate tables with markup for operational overhead.

**Core Problem**: Without metrics collection, we cannot:
- Estimate monthly costs in real-time
- Allocate costs to users/channels/videos
- Set and enforce budgets
- Make informed decisions about expensive features (transcription, AI search)

## Decision

Implement a metrics-first cost estimation system:

1. **Collect raw metrics** at key points in our code
2. **Store in D1** using `usage_metrics` table
3. **Apply rate tables** to calculate base costs
4. **Add markup** (20-50%) by category for operational overhead
5. **Calculate costs** on-demand from stored metrics

### D1 Schema

```sql
-- usage_metrics: Raw usage data collected from our systems
CREATE TABLE usage_metrics (
    id TEXT PRIMARY KEY,
    metric_type TEXT NOT NULL,        -- storage, bandwidth, transcription, embedding, gpu_time, vectorize_query
    scope TEXT NOT NULL,              -- system, user, channel, video
    scope_id TEXT,                    -- user_id, channel_id, or video_id (null for system scope)

    -- Raw values (store in base units, only populate relevant field)
    value_bytes INTEGER,              -- For storage, bandwidth
    value_minutes REAL,               -- For transcription, video duration
    value_seconds REAL,               -- For GPU time
    value_tokens INTEGER,             -- For embeddings
    value_requests INTEGER,           -- For API calls, vectorize queries

    -- Time tracking
    period TEXT NOT NULL,             -- '2025-01' for monthly aggregation
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,

    -- Source tracking
    source TEXT NOT NULL              -- upload, processor, api, cron
);

CREATE INDEX idx_usage_metrics_scope ON usage_metrics(scope, scope_id, period);
CREATE INDEX idx_usage_metrics_type ON usage_metrics(metric_type, period);
CREATE INDEX idx_usage_metrics_period ON usage_metrics(period, recorded_at DESC);
```

### Rate Tables Configuration

```typescript
// apps/api-videos/src/lib/costConfig.ts

export interface RateTable {
  provider: string;
  service: string;
  unit: 'GB_MONTH' | 'GB' | 'MINUTE' | 'HOUR' | 'K_TOKENS' | 'MILLION' | 'MILLION_QUERIES';
  ratePerUnitCents: number;  // Cost in cents per unit
  effectiveDate: string;
}

export const RATE_TABLES: RateTable[] = [
  // Bunny.net
  { provider: 'bunny', service: 'storage', unit: 'GB_MONTH', ratePerUnitCents: 1, effectiveDate: '2025-01-01' },
  { provider: 'bunny', service: 'bandwidth', unit: 'GB', ratePerUnitCents: 1, effectiveDate: '2025-01-01' },

  // Cloudflare D1
  { provider: 'cloudflare', service: 'd1_storage', unit: 'GB_MONTH', ratePerUnitCents: 75, effectiveDate: '2025-01-01' },
  { provider: 'cloudflare', service: 'd1_reads', unit: 'MILLION', ratePerUnitCents: 1, effectiveDate: '2025-01-01' },
  { provider: 'cloudflare', service: 'd1_writes', unit: 'MILLION', ratePerUnitCents: 100, effectiveDate: '2025-01-01' },

  // Cloudflare AI
  { provider: 'cloudflare', service: 'workers_ai_whisper', unit: 'MINUTE', ratePerUnitCents: 0.05, effectiveDate: '2025-01-01' },
  { provider: 'cloudflare', service: 'workers_ai_embedding', unit: 'K_TOKENS', ratePerUnitCents: 0.001, effectiveDate: '2025-01-01' },
  { provider: 'cloudflare', service: 'vectorize', unit: 'MILLION_QUERIES', ratePerUnitCents: 1, effectiveDate: '2025-01-01' },

  // RunPod GPU
  { provider: 'runpod', service: 'gpu_rtx4090', unit: 'HOUR', ratePerUnitCents: 34, effectiveDate: '2025-01-01' },
  { provider: 'runpod', service: 'gpu_rtx3090', unit: 'HOUR', ratePerUnitCents: 22, effectiveDate: '2025-01-01' },
];
```

### Markup Configuration

```typescript
// apps/api-videos/src/lib/costConfig.ts

export interface MarkupConfig {
  category: string;
  markupPercent: number;
  description: string;
}

export const MARKUP_CONFIG: MarkupConfig[] = [
  { category: 'storage', markupPercent: 25, description: 'Redundancy, backups, overhead' },
  { category: 'bandwidth', markupPercent: 20, description: 'CDN overhead, cache misses' },
  { category: 'transcription', markupPercent: 35, description: 'Processing overhead, retries, queue management' },
  { category: 'ai_search', markupPercent: 40, description: 'Embedding generation, index maintenance, query overhead' },
  { category: 'gpu', markupPercent: 50, description: 'Job orchestration, idle time, failed job retries' },
];

// Map metric types to markup categories
export const METRIC_TO_CATEGORY: Record<string, string> = {
  'storage': 'storage',
  'bandwidth': 'bandwidth',
  'transcription': 'transcription',
  'embedding': 'ai_search',
  'vectorize_query': 'ai_search',
  'gpu_time': 'gpu',
};
```

### Collection Points

Metrics are collected at these code locations:

```typescript
// 1. Video Upload (apps/api-videos/src/endpoints/video/videoCreate.ts)
// Track: storage bytes
async function onVideoUploaded(video: Video, userId: string, channelId: string) {
  await recordMetric(env.DB, {
    metricType: 'storage',
    scope: 'video',
    scopeId: video.id,
    valueBytes: video.fileSizeBytes,
    period: getCurrentMonth(),
    source: 'upload',
  });

  // Aggregate to user scope
  await recordMetric(env.DB, {
    metricType: 'storage',
    scope: 'user',
    scopeId: userId,
    valueBytes: video.fileSizeBytes,
    period: getCurrentMonth(),
    source: 'upload',
  });
}

// 2. Video View (apps/processor/src/handlers/videoView.ts)
// Track: bandwidth bytes (estimated from bitrate * watch duration)
async function onVideoView(event: VideoViewEvent) {
  const bandwidthBytes = estimateBandwidth(event.videoBitrate, event.watchDurationSeconds);

  await recordMetric(env.DB, {
    metricType: 'bandwidth',
    scope: 'video',
    scopeId: event.videoId,
    valueBytes: bandwidthBytes,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 3. Transcription Complete (apps/processor/src/handlers/runpodWebhook.ts)
// Track: transcription minutes, GPU seconds
async function onTranscriptionComplete(job: RunPodJob) {
  await recordMetric(env.DB, {
    metricType: 'transcription',
    scope: 'video',
    scopeId: job.videoId,
    valueMinutes: job.audioDurationMinutes,
    period: getCurrentMonth(),
    source: 'processor',
  });

  await recordMetric(env.DB, {
    metricType: 'gpu_time',
    scope: 'system',
    scopeId: null,
    valueSeconds: job.gpuSecondsUsed,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 4. Embedding Generation (apps/processor/src/handlers/embedding.ts)
// Track: tokens used
async function onEmbeddingGenerated(videoId: string, tokensUsed: number) {
  await recordMetric(env.DB, {
    metricType: 'embedding',
    scope: 'video',
    scopeId: videoId,
    valueTokens: tokensUsed,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 5. AI Search Query (apps/api-videos/src/endpoints/search/aiSearch.ts)
// Track: vectorize queries
async function onSearchQuery(userId: string) {
  await recordMetric(env.DB, {
    metricType: 'vectorize_query',
    scope: 'user',
    scopeId: userId,
    valueRequests: 1,
    period: getCurrentMonth(),
    source: 'api',
  });
}
```

### Cost Calculation Logic

```typescript
// apps/api-videos/src/lib/costCalculator.ts

import { RATE_TABLES, MARKUP_CONFIG, METRIC_TO_CATEGORY } from './costConfig';

export interface CostBreakdown {
  baseCostCents: number;
  markupCents: number;
  totalCostCents: number;
}

export class CostCalculator {
  constructor(private db: D1Database) {}

  /**
   * Calculate cost for a single metric value
   */
  calculateUnitCost(metricType: string, value: number, unit: string): CostBreakdown {
    const rate = RATE_TABLES.find(r => r.service === metricType && r.unit === unit);
    if (!rate) {
      throw new Error(`No rate found for ${metricType}/${unit}`);
    }

    const baseCostCents = value * rate.ratePerUnitCents;
    const category = METRIC_TO_CATEGORY[metricType] || 'general';
    const markup = MARKUP_CONFIG.find(m => m.category === category);
    const markupPercent = markup?.markupPercent || 25;
    const markupCents = Math.ceil(baseCostCents * (markupPercent / 100));

    return {
      baseCostCents: Math.ceil(baseCostCents),
      markupCents,
      totalCostCents: Math.ceil(baseCostCents + markupCents),
    };
  }

  /**
   * Calculate monthly costs from aggregated metrics
   */
  async calculateMonthlyCosts(period: string): Promise<{
    byCategory: Record<string, CostBreakdown>;
    systemTotal: CostBreakdown;
  }> {
    const metrics = await this.db.prepare(`
      SELECT
        metric_type,
        SUM(value_bytes) as total_bytes,
        SUM(value_minutes) as total_minutes,
        SUM(value_seconds) as total_seconds,
        SUM(value_tokens) as total_tokens,
        SUM(value_requests) as total_requests
      FROM usage_metrics
      WHERE period = ? AND scope = 'system'
      GROUP BY metric_type
    `).bind(period).all();

    const byCategory: Record<string, CostBreakdown> = {};
    let totalBase = 0;
    let totalMarkup = 0;

    for (const m of metrics.results as any[]) {
      const cost = this.calculateMetricCost(m);
      byCategory[m.metric_type] = cost;
      totalBase += cost.baseCostCents;
      totalMarkup += cost.markupCents;
    }

    return {
      byCategory,
      systemTotal: {
        baseCostCents: totalBase,
        markupCents: totalMarkup,
        totalCostCents: totalBase + totalMarkup,
      },
    };
  }

  private calculateMetricCost(metric: any): CostBreakdown {
    // Convert raw values to appropriate units and calculate
    if (metric.total_bytes) {
      const gb = metric.total_bytes / (1024 * 1024 * 1024);
      return this.calculateUnitCost(metric.metric_type, gb, 'GB');
    }
    if (metric.total_minutes) {
      return this.calculateUnitCost(metric.metric_type, metric.total_minutes, 'MINUTE');
    }
    if (metric.total_seconds) {
      const hours = metric.total_seconds / 3600;
      return this.calculateUnitCost(metric.metric_type, hours, 'HOUR');
    }
    if (metric.total_tokens) {
      const kTokens = metric.total_tokens / 1000;
      return this.calculateUnitCost(metric.metric_type, kTokens, 'K_TOKENS');
    }
    if (metric.total_requests) {
      const millions = metric.total_requests / 1000000;
      return this.calculateUnitCost(metric.metric_type, millions, 'MILLION_QUERIES');
    }
    return { baseCostCents: 0, markupCents: 0, totalCostCents: 0 };
  }
}
```

### Metrics Recording Helper

```typescript
// apps/api-videos/src/lib/metricsRecorder.ts

export interface MetricRecord {
  metricType: string;
  scope: 'system' | 'user' | 'channel' | 'video';
  scopeId: string | null;
  valueBytes?: number;
  valueMinutes?: number;
  valueSeconds?: number;
  valueTokens?: number;
  valueRequests?: number;
  period: string;
  source: string;
}

export async function recordMetric(db: D1Database, metric: MetricRecord): Promise<void> {
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO usage_metrics (
      id, metric_type, scope, scope_id,
      value_bytes, value_minutes, value_seconds, value_tokens, value_requests,
      period, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    metric.metricType,
    metric.scope,
    metric.scopeId,
    metric.valueBytes || null,
    metric.valueMinutes || null,
    metric.valueSeconds || null,
    metric.valueTokens || null,
    metric.valueRequests || null,
    metric.period,
    metric.source
  ).run();
}

export function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // '2025-01'
}

export function estimateBandwidth(bitrateKbps: number, durationSeconds: number): number {
  // Returns bytes
  return (bitrateKbps * 1000 / 8) * durationSeconds;
}
```

## Consequences

### Positive

1. **Real-time cost visibility**: Dashboard shows current spend vs. budget
2. **Granular allocation**: Costs attributed to users, channels, videos
3. **Markup transparency**: Clear separation of base cost vs. operational overhead
4. **Budget control**: Enable alerts when approaching budget thresholds
5. **Feature decisions**: Data-driven decisions on expensive features

### Negative

1. **D1 write overhead**: Every usage event writes to D1 (~1ms latency)
2. **Estimation, not exact**: Calculated costs may differ from provider invoices
3. **Rate table maintenance**: Must update when provider pricing changes

### Mitigations

1. **Batch writes**: Processor batches multiple metrics per queue batch
2. **Monthly reconciliation**: Compare estimates vs. actual bills, adjust rates
3. **Versioned rates**: `effectiveDate` allows rate changes without losing history

## Implementation Notes

**Phase 1 Deliverables:**
- [ ] D1 migration for `usage_metrics` table
- [ ] `costConfig.ts` with rate tables and markup
- [ ] `costCalculator.ts` with calculation logic
- [ ] `metricsRecorder.ts` with helper functions

**Integration Points:**
- Video upload endpoint -> storage metric
- Queue processor -> bandwidth, transcription, embedding, GPU metrics
- Search endpoint -> vectorize query metric

**Testing:**
- Unit tests for cost calculation with known inputs
- Integration tests verifying metrics are recorded
- Compare calculated costs against known provider invoices

## References

- [Analytics Dashboard Architecture](../research/analytics-dashboard-architecture.md) - Full system design
- [ADR-0005: D1 Database Integration](./0005-d1-database-integration.md) - D1 schema patterns
- [Cloudflare D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Bunny.net Pricing](https://bunny.net/pricing/)
- [RunPod Pricing](https://www.runpod.io/pricing)
