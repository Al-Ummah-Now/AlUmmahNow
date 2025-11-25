# Analytics Dashboard & Infrastructure Management Architecture

**Date**: 2025-01-25
**Status**: Planning
**Context**: 30TB video platform requiring full observability, cost management, and infrastructure orchestration

## Overview

Build a comprehensive system for:
1. **System Analytics** - Real-time platform health and usage
2. **Cost Management** - Track and predict costs across all providers
3. **User Billing** - Subscriptions, quotas, per-video costs
4. **Feature Flags** - Toggleable features per user/channel
5. **Infrastructure Orchestration** - Manage RunPod, queues, retries
6. **Resilience** - Retry logic, circuit breakers, fallbacks

---

## 1. System Analytics Dashboard

### 1.1 Metrics to Track

#### Platform Health
| Metric | Source | Granularity |
|--------|--------|-------------|
| API request count | Workers Analytics | Per minute |
| API latency (p50, p95, p99) | Workers Analytics | Per minute |
| Error rate | Workers Analytics | Per minute |
| Active users | Analytics Engine | Per minute |
| Concurrent streams | WebSocket server | Real-time |

#### Storage Metrics
| Metric | Source | Granularity |
|--------|--------|-------------|
| R2 storage used | Cloudflare API | Daily |
| R2 read/write ops | Cloudflare API | Hourly |
| Bunny storage used | Bunny API | Daily |
| Bunny bandwidth | Bunny API | Hourly |
| D1 database size | Cloudflare API | Daily |

#### Processing Metrics
| Metric | Source | Granularity |
|--------|--------|-------------|
| Queue depth | Cloudflare Queues | Per minute |
| Queue processing rate | Analytics Engine | Per minute |
| Failed jobs | Analytics Engine | Per minute |
| RunPod GPU hours | RunPod API | Per job |
| Transcription minutes | Analytics Engine | Per job |

#### Content Metrics
| Metric | Source | Granularity |
|--------|--------|-------------|
| Total videos | D1 | Daily |
| Total channels | D1 | Daily |
| Total watch time | Analytics Engine | Hourly |
| Video uploads today | Analytics Engine | Hourly |
| Storage growth rate | Calculated | Daily |

### 1.2 Dashboard Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ADMIN DASHBOARD                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Health    │  │    Costs    │  │   Storage   │  │   Queue     │    │
│  │   ✓ 99.9%   │  │  $342/day   │  │  30.2 TB    │  │   1,234     │    │
│  │   uptime    │  │  ↑ 5%       │  │  ↑ 50GB     │  │   pending   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    COST BREAKDOWN (Last 30 Days)                 │    │
│  │  ████████████████████████░░░░░░░░  Bunny Storage    $300        │    │
│  │  ██████████░░░░░░░░░░░░░░░░░░░░░░  Bunny Bandwidth  $120        │    │
│  │  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Cloudflare D1    $5          │    │
│  │  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  RunPod GPU       $45         │    │
│  │  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Vectorize        $5          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐      │
│  │     PROCESSING QUEUE        │  │      INFRASTRUCTURE         │      │
│  │                             │  │                             │      │
│  │  Pending:     1,234         │  │  RunPod: ● 2 active jobs   │      │
│  │  Processing:  45            │  │  Workers: ● healthy        │      │
│  │  Failed:      12            │  │  D1: ● 2.3GB / 10GB        │      │
│  │  Completed:   45,678        │  │  Queues: ● nominal         │      │
│  │                             │  │                             │      │
│  │  [View Failed Jobs]         │  │  [Manage Infrastructure]   │      │
│  └─────────────────────────────┘  └─────────────────────────────┘      │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    REAL-TIME ACTIVITY                            │    │
│  │                                                                   │    │
│  │  12:45:32  Video uploaded      user_123    "Islamic History #5"  │    │
│  │  12:45:30  Transcription done  video_456   Duration: 45min       │    │
│  │  12:45:28  New subscriber      channel_789  +1 (total: 1,234)    │    │
│  │  12:45:25  Video processed     video_012   Ready for streaming   │    │
│  │                                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cost Management System

### 2.1 Philosophy: Metrics First, Costs Calculated

**Important**: Providers don't give real-time cost APIs. We must:
1. **Collect raw metrics** (bytes, minutes, requests, etc.)
2. **Apply rate tables** to calculate estimated costs
3. **Add markup** (20-50%) for operational overhead

### 2.2 Raw Metrics Collection Schema (D1)

```sql
-- Raw usage metrics (collected from our systems, not provider APIs)
CREATE TABLE usage_metrics (
    id TEXT PRIMARY KEY,
    metric_type TEXT NOT NULL,        -- 'storage', 'bandwidth', 'transcription', 'embedding', 'gpu_time'
    scope TEXT NOT NULL,              -- 'system', 'user', 'channel', 'video'
    scope_id TEXT,                    -- user_id, channel_id, or video_id

    -- Raw values (always store in base units)
    value_bytes INTEGER,              -- For storage, bandwidth
    value_minutes REAL,               -- For transcription, video duration
    value_seconds REAL,               -- For GPU time
    value_tokens INTEGER,             -- For embeddings
    value_requests INTEGER,           -- For API calls

    -- Time tracking
    period TEXT NOT NULL,             -- '2025-01' for monthly, '2025-01-15' for daily
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,

    -- Source
    source TEXT NOT NULL              -- 'upload', 'processor', 'api', 'cron'
);

CREATE INDEX idx_usage_metrics_scope ON usage_metrics(scope, scope_id, period);
CREATE INDEX idx_usage_metrics_type ON usage_metrics(metric_type, period);
```

### 2.3 Rate Tables & Markup Configuration

```typescript
// Rate tables - update when provider pricing changes
interface RateTable {
  provider: string;
  service: string;
  unit: string;
  ratePerUnit: number;  // Cost in cents
  effectiveDate: string;
}

const RATE_TABLES: RateTable[] = [
  // Bunny.net
  { provider: 'bunny', service: 'storage', unit: 'GB_MONTH', ratePerUnit: 1, effectiveDate: '2025-01-01' },
  { provider: 'bunny', service: 'bandwidth', unit: 'GB', ratePerUnit: 1, effectiveDate: '2025-01-01' },

  // Cloudflare
  { provider: 'cloudflare', service: 'd1_storage', unit: 'GB_MONTH', ratePerUnit: 75, effectiveDate: '2025-01-01' },  // $0.75/GB
  { provider: 'cloudflare', service: 'd1_reads', unit: 'MILLION', ratePerUnit: 1, effectiveDate: '2025-01-01' },  // $0.01/M
  { provider: 'cloudflare', service: 'd1_writes', unit: 'MILLION', ratePerUnit: 100, effectiveDate: '2025-01-01' }, // $1/M
  { provider: 'cloudflare', service: 'vectorize', unit: 'MILLION_QUERIES', ratePerUnit: 1, effectiveDate: '2025-01-01' },
  { provider: 'cloudflare', service: 'workers_ai_whisper', unit: 'MINUTE', ratePerUnit: 0.05, effectiveDate: '2025-01-01' }, // $0.0005/min
  { provider: 'cloudflare', service: 'workers_ai_embedding', unit: 'K_TOKENS', ratePerUnit: 0.001, effectiveDate: '2025-01-01' },

  // RunPod
  { provider: 'runpod', service: 'gpu_rtx4090', unit: 'HOUR', ratePerUnit: 34, effectiveDate: '2025-01-01' }, // $0.34/hr
  { provider: 'runpod', service: 'gpu_rtx3090', unit: 'HOUR', ratePerUnit: 22, effectiveDate: '2025-01-01' }, // $0.22/hr
];

// Markup configuration
interface MarkupConfig {
  category: string;
  markupPercent: number;  // 20-50%
  description: string;
}

const MARKUP_CONFIG: MarkupConfig[] = [
  { category: 'storage', markupPercent: 25, description: 'Storage overhead, redundancy' },
  { category: 'bandwidth', markupPercent: 20, description: 'CDN overhead' },
  { category: 'transcription', markupPercent: 35, description: 'Processing overhead, retries, queue management' },
  { category: 'ai_search', markupPercent: 40, description: 'Embedding generation, index maintenance' },
  { category: 'gpu', markupPercent: 50, description: 'Job orchestration, idle time, failed jobs' },
];
```

### 2.4 Cost Calculation Service

```typescript
class CostCalculator {
  constructor(
    private db: D1Database,
    private rateTables: RateTable[],
    private markupConfig: MarkupConfig[]
  ) {}

  // Calculate cost from raw metrics
  calculateCost(metricType: string, value: number, unit: string): {
    baseCostCents: number;
    markupCents: number;
    totalCostCents: number;
  } {
    const rate = this.rateTables.find(r => r.service === metricType && r.unit === unit);
    if (!rate) {
      throw new Error(`No rate found for ${metricType}/${unit}`);
    }

    const baseCostCents = value * rate.ratePerUnit;

    const markup = this.markupConfig.find(m => m.category === this.getCategory(metricType));
    const markupPercent = markup?.markupPercent || 25;
    const markupCents = Math.ceil(baseCostCents * (markupPercent / 100));

    return {
      baseCostCents: Math.ceil(baseCostCents),
      markupCents,
      totalCostCents: Math.ceil(baseCostCents + markupCents),
    };
  }

  // Calculate monthly costs from aggregated metrics
  async calculateMonthlyCosts(period: string): Promise<{
    byCategory: Record<string, { base: number; markup: number; total: number }>;
    systemTotal: { base: number; markup: number; total: number };
  }> {
    // Aggregate metrics by type
    const metrics = await this.db.prepare(`
      SELECT metric_type,
             SUM(value_bytes) as total_bytes,
             SUM(value_minutes) as total_minutes,
             SUM(value_seconds) as total_seconds,
             SUM(value_tokens) as total_tokens
      FROM usage_metrics
      WHERE period = ? AND scope = 'system'
      GROUP BY metric_type
    `).bind(period).all();

    const byCategory: Record<string, { base: number; markup: number; total: number }> = {};
    let systemBase = 0;
    let systemMarkup = 0;

    for (const m of metrics.results) {
      const cost = this.calculateMetricCost(m);
      byCategory[m.metric_type] = cost;
      systemBase += cost.base;
      systemMarkup += cost.markup;
    }

    return {
      byCategory,
      systemTotal: {
        base: systemBase,
        markup: systemMarkup,
        total: systemBase + systemMarkup,
      },
    };
  }

  private getCategory(metricType: string): string {
    const categoryMap: Record<string, string> = {
      'storage': 'storage',
      'bandwidth': 'bandwidth',
      'transcription': 'transcription',
      'embedding': 'ai_search',
      'vectorize_query': 'ai_search',
      'gpu_time': 'gpu',
    };
    return categoryMap[metricType] || 'general';
  }
}
```

### 2.5 Metrics Collection Points

```typescript
// Where we collect metrics in the system:

// 1. On video upload (apps/api-videos)
async function onVideoUploaded(video: Video, userId: string, channelId: string) {
  await recordMetric({
    metricType: 'storage',
    scope: 'video',
    scopeId: video.id,
    valueBytes: video.fileSizeBytes,
    period: getCurrentMonth(),
    source: 'upload',
  });

  // Also record for user and channel aggregation
  await recordMetric({
    metricType: 'storage',
    scope: 'user',
    scopeId: userId,
    valueBytes: video.fileSizeBytes,
    period: getCurrentMonth(),
    source: 'upload',
  });
}

// 2. On video view (apps/processor - from queue)
async function onVideoView(event: VideoViewEvent) {
  // Estimate bandwidth based on video bitrate and watch duration
  const bandwidthBytes = estimateBandwidth(event.videoId, event.watchDurationSeconds);

  await recordMetric({
    metricType: 'bandwidth',
    scope: 'video',
    scopeId: event.videoId,
    valueBytes: bandwidthBytes,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 3. On transcription complete (RunPod webhook)
async function onTranscriptionComplete(job: RunPodJob) {
  await recordMetric({
    metricType: 'transcription',
    scope: 'video',
    scopeId: job.videoId,
    valueMinutes: job.audioDurationMinutes,
    period: getCurrentMonth(),
    source: 'processor',
  });

  await recordMetric({
    metricType: 'gpu_time',
    scope: 'system',
    scopeId: null,
    valueSeconds: job.gpuSecondsUsed,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 4. On embedding generation
async function onEmbeddingGenerated(videoId: string, tokensUsed: number) {
  await recordMetric({
    metricType: 'embedding',
    scope: 'video',
    scopeId: videoId,
    valueTokens: tokensUsed,
    period: getCurrentMonth(),
    source: 'processor',
  });
}

// 5. On AI search query
async function onSearchQuery(userId: string) {
  await recordMetric({
    metricType: 'vectorize_query',
    scope: 'user',
    scopeId: userId,
    valueRequests: 1,
    period: getCurrentMonth(),
    source: 'api',
  });
}
```

### 2.6 Cost Allocation Schema (Calculated)

```sql
-- Cost allocations (calculated from metrics, not from provider APIs)
CREATE TABLE cost_allocations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    video_id TEXT,
    cost_type TEXT NOT NULL,          -- 'storage', 'transcription', 'bandwidth'
    amount_cents INTEGER NOT NULL,
    period TEXT NOT NULL,             -- '2025-01' (monthly)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Budget alerts
CREATE TABLE budget_alerts (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,              -- 'system', 'user', 'channel'
    scope_id TEXT,                    -- user_id or channel_id
    budget_cents INTEGER NOT NULL,
    current_spend_cents INTEGER DEFAULT 0,
    alert_threshold_percent INTEGER DEFAULT 80,
    alert_sent_at TEXT,
    period TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_provider_costs_period ON provider_costs(period_start, provider);
CREATE INDEX idx_cost_allocations_user ON cost_allocations(user_id, period);
CREATE INDEX idx_budget_alerts_scope ON budget_alerts(scope, scope_id);
```

### 2.2 Cost Calculation Per Video

```typescript
interface VideoCostBreakdown {
  videoId: string;
  channelId: string;
  userId: string;

  // Storage costs (monthly)
  storage: {
    videoSizeGB: number;
    monthlyCostCents: number;  // $0.01/GB = 1 cent/GB
  };

  // Processing costs (one-time)
  processing: {
    transcodingMinutes: number;
    transcodingCostCents: number;  // Included in Bunny
  };

  // Transcription costs (one-time)
  transcription: {
    durationMinutes: number;
    costCents: number;  // ~$0.019/min via RunPod
    enabled: boolean;
  };

  // Embedding costs (one-time)
  embedding: {
    tokensUsed: number;
    costCents: number;  // $0.00001/1k tokens
    enabled: boolean;
  };

  // Bandwidth costs (ongoing)
  bandwidth: {
    viewsThisMonth: number;
    estimatedGBDelivered: number;
    costCents: number;  // $0.01/GB
  };

  // Total
  totalOneTimeCents: number;
  totalMonthlyCents: number;
}

// Example calculation
function calculateVideoCost(video: Video): VideoCostBreakdown {
  const storageCostPerGB = 1; // cents
  const transcriptionCostPerMin = 1.9; // cents ($0.019/min via RunPod)
  const bandwidthCostPerGB = 1; // cents
  const avgBitrateKbps = 4000; // 4 Mbps average

  const storageCost = video.fileSizeGB * storageCostPerGB;
  const transcriptionCost = video.transcriptionEnabled
    ? video.durationMinutes * transcriptionCostPerMin
    : 0;

  const gbPerView = (avgBitrateKbps * video.durationSeconds) / (8 * 1024 * 1024);
  const bandwidthCost = video.viewsThisMonth * gbPerView * bandwidthCostPerGB;

  return {
    videoId: video.id,
    storage: { videoSizeGB: video.fileSizeGB, monthlyCostCents: storageCost },
    transcription: {
      durationMinutes: video.durationMinutes,
      costCents: transcriptionCost,
      enabled: video.transcriptionEnabled
    },
    bandwidth: {
      viewsThisMonth: video.viewsThisMonth,
      estimatedGBDelivered: video.viewsThisMonth * gbPerView,
      costCents: bandwidthCost
    },
    totalOneTimeCents: transcriptionCost,
    totalMonthlyCents: storageCost + bandwidthCost,
  };
}
```

### 2.3 Cost Forecasting

```typescript
interface CostForecast {
  period: string;  // '2025-02'

  // Based on current growth rate
  projected: {
    storage: {
      currentTB: number;
      projectedTB: number;
      growthRate: number;  // % per month
      costCents: number;
    };
    bandwidth: {
      currentGB: number;
      projectedGB: number;
      costCents: number;
    };
    transcription: {
      pendingVideos: number;
      pendingMinutes: number;
      costCents: number;
    };
    gpu: {
      projectedHours: number;
      costCents: number;
    };
  };

  totalProjectedCents: number;
  budgetCents: number;
  budgetVariance: number;  // positive = under budget
}
```

---

## 3. Subscription & User Billing

### 3.1 Subscription Tiers

```typescript
interface SubscriptionTier {
  id: string;
  name: string;
  nameAr: string;

  // Pricing
  monthlyPriceCents: number;
  yearlyPriceCents: number;

  // Quotas
  quotas: {
    storageGB: number;           // Max storage
    uploadMinutesPerMonth: number; // Max upload duration
    channelsAllowed: number;
    videosPerChannel: number;

    // Feature limits
    maxVideoLengthMinutes: number;
    maxFileSizeGB: number;
  };

  // Features included
  features: {
    transcription: boolean;
    aiSearch: boolean;
    analytics: 'basic' | 'advanced' | 'full';
    customBranding: boolean;
    priorityProcessing: boolean;
    apiAccess: boolean;
    liveStreaming: boolean;
  };

  // Overage rates (cents)
  overageRates: {
    storagePerGB: number;
    bandwidthPerGB: number;
    transcriptionPerMinute: number;
  };
}

const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    id: 'free',
    name: 'Free',
    nameAr: 'مجاني',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    quotas: {
      storageGB: 5,
      uploadMinutesPerMonth: 60,
      channelsAllowed: 1,
      videosPerChannel: 50,
      maxVideoLengthMinutes: 15,
      maxFileSizeGB: 1,
    },
    features: {
      transcription: false,
      aiSearch: false,
      analytics: 'basic',
      customBranding: false,
      priorityProcessing: false,
      apiAccess: false,
      liveStreaming: false,
    },
    overageRates: {
      storagePerGB: 0,  // No overage allowed
      bandwidthPerGB: 0,
      transcriptionPerMinute: 0,
    },
  },
  {
    id: 'creator',
    name: 'Creator',
    nameAr: 'منشئ',
    monthlyPriceCents: 999,  // $9.99/month
    yearlyPriceCents: 9990,  // $99.90/year (2 months free)
    quotas: {
      storageGB: 100,
      uploadMinutesPerMonth: 600,  // 10 hours
      channelsAllowed: 3,
      videosPerChannel: 500,
      maxVideoLengthMinutes: 120,
      maxFileSizeGB: 10,
    },
    features: {
      transcription: true,
      aiSearch: true,
      analytics: 'advanced',
      customBranding: false,
      priorityProcessing: false,
      apiAccess: false,
      liveStreaming: false,
    },
    overageRates: {
      storagePerGB: 2,      // $0.02/GB
      bandwidthPerGB: 2,    // $0.02/GB
      transcriptionPerMinute: 3, // $0.03/min
    },
  },
  {
    id: 'professional',
    name: 'Professional',
    nameAr: 'محترف',
    monthlyPriceCents: 2999,  // $29.99/month
    yearlyPriceCents: 29990,  // $299.90/year
    quotas: {
      storageGB: 1000,      // 1 TB
      uploadMinutesPerMonth: 6000,  // 100 hours
      channelsAllowed: 10,
      videosPerChannel: 2000,
      maxVideoLengthMinutes: 480,  // 8 hours
      maxFileSizeGB: 50,
    },
    features: {
      transcription: true,
      aiSearch: true,
      analytics: 'full',
      customBranding: true,
      priorityProcessing: true,
      apiAccess: true,
      liveStreaming: true,
    },
    overageRates: {
      storagePerGB: 1,      // $0.01/GB
      bandwidthPerGB: 1,    // $0.01/GB
      transcriptionPerMinute: 2, // $0.02/min
    },
  },
  {
    id: 'organization',
    name: 'Organization',
    nameAr: 'مؤسسة',
    monthlyPriceCents: 9999,  // $99.99/month
    yearlyPriceCents: 99990,  // $999.90/year
    quotas: {
      storageGB: 10000,     // 10 TB
      uploadMinutesPerMonth: 60000, // 1000 hours
      channelsAllowed: 100,
      videosPerChannel: 10000,
      maxVideoLengthMinutes: 720,  // 12 hours
      maxFileSizeGB: 100,
    },
    features: {
      transcription: true,
      aiSearch: true,
      analytics: 'full',
      customBranding: true,
      priorityProcessing: true,
      apiAccess: true,
      liveStreaming: true,
    },
    overageRates: {
      storagePerGB: 1,
      bandwidthPerGB: 1,
      transcriptionPerMinute: 2,
    },
  },
];
```

### 3.2 User Usage Tracking Schema

```sql
-- User subscriptions
CREATE TABLE user_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    tier_id TEXT NOT NULL,
    status TEXT NOT NULL,             -- 'active', 'cancelled', 'past_due'
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    cancel_at_period_end INTEGER DEFAULT 0,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Usage tracking (reset monthly)
CREATE TABLE user_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,             -- '2025-01'

    -- Storage (cumulative)
    storage_used_bytes INTEGER DEFAULT 0,

    -- Monthly counters
    upload_minutes_used INTEGER DEFAULT 0,
    bandwidth_bytes_used INTEGER DEFAULT 0,
    transcription_minutes_used INTEGER DEFAULT 0,

    -- Counts
    videos_uploaded INTEGER DEFAULT 0,
    channels_created INTEGER DEFAULT 0,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(user_id, period)
);

-- Overage charges
CREATE TABLE overage_charges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,
    charge_type TEXT NOT NULL,        -- 'storage', 'bandwidth', 'transcription'
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    rate_cents INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    invoiced INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_usage_user_period ON user_usage(user_id, period);
CREATE INDEX idx_overage_charges_user ON overage_charges(user_id, period);
```

### 3.3 User Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MY DASHBOARD                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Plan: Creator ($9.99/mo)                    [Upgrade to Professional]  │
│  Billing Period: Jan 1 - Jan 31, 2025                                   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      USAGE THIS MONTH                            │    │
│  │                                                                   │    │
│  │  Storage        ████████████████░░░░  80 GB / 100 GB            │    │
│  │  Upload Time    ██████░░░░░░░░░░░░░░  180 min / 600 min         │    │
│  │  Bandwidth      ████████████░░░░░░░░  240 GB / unlimited*       │    │
│  │  Transcription  ████████░░░░░░░░░░░░  120 min / 600 min         │    │
│  │                                                                   │    │
│  │  * Bandwidth over 500GB billed at $0.02/GB                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐      │
│  │     COST BREAKDOWN          │  │     FEATURES                │      │
│  │                             │  │                             │      │
│  │  Base Plan:      $9.99      │  │  ✓ Transcription           │      │
│  │  Storage:        $0.00      │  │  ✓ AI Search               │      │
│  │  Bandwidth:      $0.00      │  │  ✓ Advanced Analytics      │      │
│  │  Transcription:  $0.00      │  │  ✗ Custom Branding         │      │
│  │  ─────────────────────      │  │  ✗ Priority Processing     │      │
│  │  Total:          $9.99      │  │  ✗ Live Streaming          │      │
│  │                             │  │                             │      │
│  │  [View Invoice]             │  │  [Manage Features]         │      │
│  └─────────────────────────────┘  └─────────────────────────────┘      │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      VIDEO COSTS                                 │    │
│  │                                                                   │    │
│  │  Video                          Storage   Transc.   Bandwidth    │    │
│  │  ─────────────────────────────────────────────────────────────   │    │
│  │  Islamic History Episode 5      2.3 GB    45 min    12.5 GB      │    │
│  │                                 $0.02     $0.86     $0.25        │    │
│  │                                                                   │    │
│  │  Quran Recitation Surah 2       1.1 GB    120 min   45.2 GB      │    │
│  │                                 $0.01     $2.28     $0.90        │    │
│  │                                                                   │    │
│  │  [View All Videos]                                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Feature Flags System

### 4.1 Feature Flag Schema

```sql
-- Global feature flags
CREATE TABLE feature_flags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    default_enabled INTEGER DEFAULT 0,

    -- Rollout configuration
    rollout_percentage INTEGER DEFAULT 0,  -- 0-100

    -- Targeting
    enabled_tiers TEXT,               -- JSON array: ["creator", "professional"]
    enabled_users TEXT,               -- JSON array of user IDs (override)
    disabled_users TEXT,              -- JSON array of user IDs (override)

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Per-channel feature overrides
CREATE TABLE channel_features (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    enabled_by TEXT,                  -- admin user ID
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(channel_id, feature_id)
);

-- Feature usage tracking
CREATE TABLE feature_usage (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    video_id TEXT,
    used_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feature_flags_name ON feature_flags(name);
CREATE INDEX idx_channel_features_channel ON channel_features(channel_id);
```

### 4.2 Feature Flag Service

```typescript
interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  rolloutPercentage: number;
  enabledTiers: string[];
  enabledUsers: string[];
  disabledUsers: string[];
}

class FeatureFlagService {
  constructor(private db: D1Database, private kv: KVNamespace) {}

  async isEnabled(
    featureName: string,
    context: { userId: string; channelId?: string; tier: string }
  ): Promise<boolean> {
    // Check cache first
    const cacheKey = `ff:${featureName}:${context.userId}:${context.channelId || ''}`;
    const cached = await this.kv.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    // Get feature flag
    const flag = await this.db.prepare(
      'SELECT * FROM feature_flags WHERE name = ?'
    ).bind(featureName).first<FeatureFlag>();

    if (!flag) {
      return false;
    }

    // Check user override (disabled takes precedence)
    if (flag.disabledUsers?.includes(context.userId)) {
      await this.cacheResult(cacheKey, false);
      return false;
    }

    if (flag.enabledUsers?.includes(context.userId)) {
      await this.cacheResult(cacheKey, true);
      return true;
    }

    // Check channel override
    if (context.channelId) {
      const channelOverride = await this.db.prepare(
        'SELECT enabled FROM channel_features WHERE channel_id = ? AND feature_id = ?'
      ).bind(context.channelId, flag.id).first<{ enabled: number }>();

      if (channelOverride) {
        await this.cacheResult(cacheKey, channelOverride.enabled === 1);
        return channelOverride.enabled === 1;
      }
    }

    // Check tier
    if (flag.enabledTiers?.includes(context.tier)) {
      await this.cacheResult(cacheKey, true);
      return true;
    }

    // Check rollout percentage
    if (flag.rolloutPercentage > 0) {
      const hash = this.hashUserId(context.userId);
      const bucket = hash % 100;
      if (bucket < flag.rolloutPercentage) {
        await this.cacheResult(cacheKey, true);
        return true;
      }
    }

    // Default
    await this.cacheResult(cacheKey, flag.defaultEnabled);
    return flag.defaultEnabled;
  }

  private async cacheResult(key: string, value: boolean): Promise<void> {
    await this.kv.put(key, value.toString(), { expirationTtl: 300 }); // 5 min cache
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
```

### 4.3 Feature Model (Corrected)

Three types of features:

| Type | Who Controls | Examples | How It Works |
|------|-------------|----------|--------------|
| **System Toggles** | Admin ON/OFF | Transcription, AI Search | Platform-wide enable/disable |
| **Quotas** | Per-tier limits | Videos/week, Live streams/week, Storage | Usage counted against limit |
| **Tier Features** | Subscription gate | Sections, Video types, Community, Shorts | Unlocked by plan |

### 4.4 System Toggles (Admin-Controlled)

Admin can turn these ON/OFF for the **entire platform**:

```typescript
// System toggles - admin controls ON/OFF for entire platform
interface SystemToggle {
  name: string;
  description: string;
  enabled: boolean;           // Admin can toggle
  costTracking: {
    metricType: string;
    markupPercent: number;
  };
  estimatedMonthlyCost?: number;  // Real-time estimate shown to admin
}

const SYSTEM_TOGGLES: SystemToggle[] = [
  {
    name: 'transcription',
    description: 'AI-powered video transcription for all new uploads',
    enabled: true,  // Admin can turn OFF to disable platform-wide
    costTracking: {
      metricType: 'transcription_minutes',
      markupPercent: 35,
    },
  },
  {
    name: 'ai_search',
    description: 'Semantic search across all video transcripts',
    enabled: true,
    costTracking: {
      metricType: 'vectorize_query',
      markupPercent: 40,
    },
  },
  {
    name: 'auto_embedding',
    description: 'Generate embeddings for new transcripts automatically',
    enabled: true,
    costTracking: {
      metricType: 'embedding_tokens',
      markupPercent: 40,
    },
  },
];

// D1 Schema for system toggles
// CREATE TABLE system_toggles (
//     name TEXT PRIMARY KEY,
//     enabled INTEGER NOT NULL DEFAULT 1,
//     updated_by TEXT,
//     updated_at TEXT DEFAULT CURRENT_TIMESTAMP
// );
```

### 4.5 Quotas (Per-Tier Limits)

```typescript
interface TierQuotas {
  tier: string;
  quotas: {
    // Storage
    storageGB: number;

    // Weekly limits
    videosPerWeek: number;
    liveStreamsPerWeek: number;

    // Per-video limits
    maxVideoLengthMinutes: number;
    maxFileSizeGB: number;

    // Content limits
    channelsAllowed: number;
    playlistsPerChannel: number;
  };
}

const TIER_QUOTAS: TierQuotas[] = [
  {
    tier: 'free',
    quotas: {
      storageGB: 5,
      videosPerWeek: 3,
      liveStreamsPerWeek: 0,
      maxVideoLengthMinutes: 15,
      maxFileSizeGB: 1,
      channelsAllowed: 1,
      playlistsPerChannel: 5,
    },
  },
  {
    tier: 'creator',
    quotas: {
      storageGB: 100,
      videosPerWeek: 20,
      liveStreamsPerWeek: 2,
      maxVideoLengthMinutes: 120,
      maxFileSizeGB: 10,
      channelsAllowed: 3,
      playlistsPerChannel: 50,
    },
  },
  {
    tier: 'professional',
    quotas: {
      storageGB: 1000,
      videosPerWeek: 100,
      liveStreamsPerWeek: 10,
      maxVideoLengthMinutes: 480,
      maxFileSizeGB: 50,
      channelsAllowed: 10,
      playlistsPerChannel: 200,
    },
  },
  {
    tier: 'organization',
    quotas: {
      storageGB: 10000,
      videosPerWeek: -1,  // Unlimited
      liveStreamsPerWeek: -1,
      maxVideoLengthMinutes: 720,
      maxFileSizeGB: 100,
      channelsAllowed: 100,
      playlistsPerChannel: -1,
    },
  },
];

// Quota tracking in D1
// CREATE TABLE user_quota_usage (
//     id TEXT PRIMARY KEY,
//     user_id TEXT NOT NULL,
//     quota_type TEXT NOT NULL,       -- 'videos_week', 'live_streams_week', 'storage'
//     period TEXT NOT NULL,           -- '2025-W04' for weekly, '2025-01' for monthly
//     used INTEGER NOT NULL DEFAULT 0,
//     limit INTEGER NOT NULL,
//     UNIQUE(user_id, quota_type, period)
// );
```

### 4.6 Tier Features (Subscription-Gated)

```typescript
interface TierFeature {
  name: string;
  description: string;
  descriptionAr: string;
  availableTiers: string[];  // Which tiers have access
  category: 'content' | 'channel' | 'analytics' | 'monetization';
}

const TIER_FEATURES: TierFeature[] = [
  // Content Features
  {
    name: 'channel_sections',
    description: 'Organize channel with custom sections',
    descriptionAr: 'تنظيم القناة بأقسام مخصصة',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'channel',
  },
  {
    name: 'shorts',
    description: 'Upload short-form vertical videos (<60s)',
    descriptionAr: 'رفع فيديوهات قصيرة عمودية',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'content',
  },
  {
    name: 'community_posts',
    description: 'Post text, images, polls to community tab',
    descriptionAr: 'نشر نصوص وصور واستطلاعات',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'content',
  },
  {
    name: 'playlists_advanced',
    description: 'Collaborative playlists, auto-add rules',
    descriptionAr: 'قوائم تشغيل تعاونية وقواعد إضافة تلقائية',
    availableTiers: ['professional', 'organization'],
    category: 'content',
  },
  {
    name: 'video_chapters',
    description: 'Add chapters/timestamps to videos',
    descriptionAr: 'إضافة فصول وطوابع زمنية',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'content',
  },
  {
    name: 'scheduled_publishing',
    description: 'Schedule videos for future release',
    descriptionAr: 'جدولة الفيديوهات للنشر المستقبلي',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'content',
  },

  // Channel Features
  {
    name: 'custom_branding',
    description: 'Custom colors, logos, watermarks',
    descriptionAr: 'ألوان وشعارات وعلامات مائية مخصصة',
    availableTiers: ['professional', 'organization'],
    category: 'channel',
  },
  {
    name: 'channel_members',
    description: 'Add team members with roles',
    descriptionAr: 'إضافة أعضاء فريق بصلاحيات',
    availableTiers: ['professional', 'organization'],
    category: 'channel',
  },

  // Analytics Features
  {
    name: 'basic_analytics',
    description: 'Views, likes, comments counts',
    descriptionAr: 'عدد المشاهدات والإعجابات والتعليقات',
    availableTiers: ['free', 'creator', 'professional', 'organization'],
    category: 'analytics',
  },
  {
    name: 'advanced_analytics',
    description: 'Audience demographics, retention graphs',
    descriptionAr: 'تحليلات الجمهور ورسوم الاحتفاظ',
    availableTiers: ['creator', 'professional', 'organization'],
    category: 'analytics',
  },
  {
    name: 'revenue_analytics',
    description: 'Revenue tracking, projections',
    descriptionAr: 'تتبع الإيرادات والتوقعات',
    availableTiers: ['professional', 'organization'],
    category: 'analytics',
  },

  // API & Integration
  {
    name: 'api_access',
    description: 'External API access with rate limits',
    descriptionAr: 'الوصول للـ API الخارجي',
    availableTiers: ['professional', 'organization'],
    category: 'channel',
  },
  {
    name: 'webhooks',
    description: 'Receive webhooks for events',
    descriptionAr: 'استقبال إشعارات الأحداث',
    availableTiers: ['organization'],
    category: 'channel',
  },
];
```

### 4.5 User Features (Per-User Toggleable)

```typescript
const USER_FEATURES = [
  {
    name: 'transcription',
    description: 'AI-powered video transcription',
    defaultEnabled: false,
    enabledTiers: ['creator', 'professional', 'organization'],
    userCanToggle: true,  // User can disable even if tier allows
    costPerUnit: {
      unit: 'minute',
      baseCents: 1.9,     // $0.019/min
      markupPercent: 35,
      displayCents: 2.6,  // What user sees: $0.026/min
    },
  },
  {
    name: 'live_streaming',
    description: 'Live video streaming capability',
    defaultEnabled: false,
    enabledTiers: ['professional', 'organization'],
    userCanToggle: true,
    costPerUnit: {
      unit: 'hour',
      baseCents: 50,      // $0.50/hr
      markupPercent: 30,
      displayCents: 65,   // $0.65/hr
    },
  },
  {
    name: 'priority_processing',
    description: 'Priority queue for video processing',
    defaultEnabled: false,
    enabledTiers: ['professional', 'organization'],
    userCanToggle: true,
    costPerUnit: null,    // Included in tier
  },
  {
    name: 'custom_branding',
    description: 'Custom channel branding and themes',
    defaultEnabled: false,
    enabledTiers: ['professional', 'organization'],
    userCanToggle: false, // Tier-controlled only
    costPerUnit: null,
  },
  {
    name: 'api_access',
    description: 'External API access',
    defaultEnabled: false,
    enabledTiers: ['professional', 'organization'],
    userCanToggle: false,
    costPerUnit: null,
  },
  {
    name: 'advanced_analytics',
    description: 'Detailed analytics and insights',
    defaultEnabled: false,
    enabledTiers: ['creator', 'professional', 'organization'],
    userCanToggle: false,
    costPerUnit: null,
  },
  {
    name: 'scheduled_publishing',
    description: 'Schedule videos for future publishing',
    defaultEnabled: true,
    enabledTiers: ['free', 'creator', 'professional', 'organization'],
    userCanToggle: false,
    costPerUnit: null,
  },
];
```

### 4.6 User Feature Toggle UI

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEATURE SETTINGS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Your Plan: Creator ($9.99/mo)                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  INCLUDED FEATURES                                       │    │
│  │                                                          │    │
│  │  ✓ AI Search              System feature (always on)    │    │
│  │  ✓ Basic Analytics        Included in all plans         │    │
│  │  ✓ Scheduled Publishing   Included in all plans         │    │
│  │  ✓ Advanced Analytics     Included in Creator+          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  OPTIONAL FEATURES (you control)                         │    │
│  │                                                          │    │
│  │  Transcription           [ON ▼]     $0.026/min          │    │
│  │  └─ Auto-transcribe new videos                          │    │
│  │  └─ This month: 45 min = $1.17                          │    │
│  │                                                          │    │
│  │  Live Streaming          [OFF ▼]    $0.65/hr            │    │
│  │  └─ Enable when you want to go live                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  UPGRADE TO UNLOCK                                       │    │
│  │                                                          │    │
│  │  🔒 Priority Processing   Professional+ required        │    │
│  │  🔒 Custom Branding       Professional+ required        │    │
│  │  🔒 API Access            Professional+ required        │    │
│  │                                                          │    │
│  │  [Upgrade to Professional - $29.99/mo]                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Infrastructure Orchestration

### 5.1 RunPod Management

```typescript
interface RunPodJob {
  id: string;
  videoId: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
  jobType: 'transcription' | 'embedding';

  // RunPod specifics
  runpodJobId?: string;
  runpodEndpointId: string;
  gpuType: string;

  // Timing
  createdAt: string;
  startedAt?: string;
  completedAt?: string;

  // Cost tracking
  gpuSecondsUsed?: number;
  estimatedCostCents?: number;

  // Retry info
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  nextRetryAt?: string;
}

class RunPodOrchestrator {
  private readonly RUNPOD_API_KEY: string;
  private readonly ENDPOINT_ID: string;
  private readonly MAX_CONCURRENT_JOBS = 10;
  private readonly MAX_RETRIES = 3;

  constructor(
    private db: D1Database,
    private queue: Queue,
    apiKey: string,
    endpointId: string
  ) {
    this.RUNPOD_API_KEY = apiKey;
    this.ENDPOINT_ID = endpointId;
  }

  async submitJob(videoId: string, jobType: 'transcription' | 'embedding'): Promise<string> {
    // Check concurrent job limit
    const activeJobs = await this.getActiveJobCount();
    if (activeJobs >= this.MAX_CONCURRENT_JOBS) {
      // Queue for later
      await this.queue.send({
        type: 'runpod_job_queued',
        videoId,
        jobType,
        queuedAt: new Date().toISOString(),
      });

      return this.createPendingJob(videoId, jobType);
    }

    return this.startJob(videoId, jobType);
  }

  private async startJob(videoId: string, jobType: 'transcription' | 'embedding'): Promise<string> {
    const jobId = crypto.randomUUID();

    // Call RunPod API
    const response = await fetch(`https://api.runpod.ai/v2/${this.ENDPOINT_ID}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          video_id: videoId,
          job_type: jobType,
          callback_url: `https://api.alummahnow.net/webhooks/runpod/${jobId}`,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`RunPod API error: ${response.status}`);
    }

    const result = await response.json();

    // Save job record
    await this.db.prepare(`
      INSERT INTO runpod_jobs (id, video_id, job_type, status, runpod_job_id, created_at, attempts)
      VALUES (?, ?, ?, 'running', ?, ?, 1)
    `).bind(jobId, videoId, jobType, result.id, new Date().toISOString()).run();

    return jobId;
  }

  async handleWebhook(jobId: string, payload: any): Promise<void> {
    const { status, output, error } = payload;

    if (status === 'COMPLETED') {
      await this.handleJobCompleted(jobId, output);
    } else if (status === 'FAILED') {
      await this.handleJobFailed(jobId, error);
    }
  }

  private async handleJobFailed(jobId: string, error: string): Promise<void> {
    const job = await this.getJob(jobId);

    if (job.attempts < this.MAX_RETRIES) {
      // Exponential backoff: 1min, 4min, 16min
      const backoffMinutes = Math.pow(4, job.attempts);
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await this.db.prepare(`
        UPDATE runpod_jobs
        SET status = 'pending',
            last_error = ?,
            next_retry_at = ?,
            attempts = attempts + 1
        WHERE id = ?
      `).bind(error, nextRetryAt.toISOString(), jobId).run();

      // Schedule retry
      await this.queue.send({
        type: 'runpod_job_retry',
        jobId,
        retryAt: nextRetryAt.toISOString(),
      }, { delaySeconds: backoffMinutes * 60 });
    } else {
      // Max retries reached - mark as failed
      await this.db.prepare(`
        UPDATE runpod_jobs
        SET status = 'failed',
            last_error = ?,
            completed_at = ?
        WHERE id = ?
      `).bind(error, new Date().toISOString(), jobId).run();

      // Alert admin
      await this.queue.send({
        type: 'admin_alert',
        alertType: 'runpod_job_failed',
        jobId,
        error,
      });
    }
  }

  async getJobStatus(jobId: string): Promise<RunPodJob> {
    return this.getJob(jobId);
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);

    if (job.runpodJobId && job.status === 'running') {
      await fetch(`https://api.runpod.ai/v2/${this.ENDPOINT_ID}/cancel/${job.runpodJobId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.RUNPOD_API_KEY}` },
      });
    }

    await this.db.prepare(`
      UPDATE runpod_jobs SET status = 'cancelled', completed_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), jobId).run();
  }

  // Admin functions
  async getActiveJobs(): Promise<RunPodJob[]> {
    const result = await this.db.prepare(`
      SELECT * FROM runpod_jobs WHERE status IN ('pending', 'running', 'queued')
      ORDER BY created_at DESC
    `).all<RunPodJob>();
    return result.results;
  }

  async getJobMetrics(): Promise<{
    activeJobs: number;
    completedToday: number;
    failedToday: number;
    avgProcessingTimeSeconds: number;
    totalCostTodayCents: number;
  }> {
    const today = new Date().toISOString().split('T')[0];

    const metrics = await this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status IN ('pending', 'running', 'queued') THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' AND date(completed_at) = ? THEN 1 END) as completed_today,
        COUNT(CASE WHEN status = 'failed' AND date(completed_at) = ? THEN 1 END) as failed_today,
        AVG(CASE WHEN status = 'completed' THEN
          (julianday(completed_at) - julianday(started_at)) * 86400
        END) as avg_time,
        SUM(CASE WHEN date(completed_at) = ? THEN estimated_cost_cents ELSE 0 END) as cost_today
      FROM runpod_jobs
    `).bind(today, today, today).first();

    return {
      activeJobs: metrics.active || 0,
      completedToday: metrics.completed_today || 0,
      failedToday: metrics.failed_today || 0,
      avgProcessingTimeSeconds: metrics.avg_time || 0,
      totalCostTodayCents: metrics.cost_today || 0,
    };
  }
}
```

### 5.2 Job Queue Schema

```sql
-- RunPod job tracking
CREATE TABLE runpod_jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    job_type TEXT NOT NULL,           -- 'transcription', 'embedding'
    status TEXT NOT NULL,             -- 'pending', 'queued', 'running', 'completed', 'failed', 'cancelled'

    -- RunPod specifics
    runpod_job_id TEXT,
    runpod_endpoint_id TEXT,
    gpu_type TEXT,

    -- Timing
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,

    -- Cost
    gpu_seconds_used INTEGER,
    estimated_cost_cents INTEGER,

    -- Retry
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    next_retry_at TEXT,

    -- Priority
    priority INTEGER DEFAULT 0        -- Higher = more urgent
);

CREATE INDEX idx_runpod_jobs_status ON runpod_jobs(status);
CREATE INDEX idx_runpod_jobs_video ON runpod_jobs(video_id);
CREATE INDEX idx_runpod_jobs_retry ON runpod_jobs(next_retry_at) WHERE status = 'pending';
```

---

## 6. Resilience Patterns

### 6.1 Circuit Breaker

```typescript
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  nextAttempt: number;
}

class CircuitBreaker {
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT_MS = 60000; // 1 minute
  private readonly HALF_OPEN_REQUESTS = 3;

  constructor(
    private kv: KVNamespace,
    private serviceName: string
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = await this.getState();

    if (state.state === 'open') {
      if (Date.now() < state.nextAttempt) {
        throw new Error(`Circuit breaker open for ${this.serviceName}`);
      }
      // Try half-open
      await this.setState({ ...state, state: 'half-open' });
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
  }

  private async recordFailure(): Promise<void> {
    const state = await this.getState();
    const newFailures = state.failures + 1;

    if (newFailures >= this.FAILURE_THRESHOLD) {
      await this.setState({
        state: 'open',
        failures: newFailures,
        lastFailure: Date.now(),
        nextAttempt: Date.now() + this.RECOVERY_TIMEOUT_MS,
      });
    } else {
      await this.setState({
        ...state,
        failures: newFailures,
        lastFailure: Date.now(),
      });
    }
  }

  private async recordSuccess(): Promise<void> {
    await this.setState({
      state: 'closed',
      failures: 0,
      lastFailure: 0,
      nextAttempt: 0,
    });
  }

  private async getState(): Promise<CircuitBreakerState> {
    const cached = await this.kv.get(`cb:${this.serviceName}`, 'json');
    return cached || { state: 'closed', failures: 0, lastFailure: 0, nextAttempt: 0 };
  }

  private async setState(state: CircuitBreakerState): Promise<void> {
    await this.kv.put(`cb:${this.serviceName}`, JSON.stringify(state), {
      expirationTtl: 3600, // 1 hour
    });
  }
}
```

### 6.2 Retry with Exponential Backoff

```typescript
interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  }
): Promise<T> {
  let lastError: Error;
  let delay = options.initialDelayMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (options.retryableErrors &&
          !options.retryableErrors.some(e => error.message.includes(e))) {
        throw error;
      }

      if (attempt === options.maxAttempts) {
        throw error;
      }

      // Wait before retry
      await sleep(delay);
      delay = Math.min(delay * options.backoffMultiplier, options.maxDelayMs);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 6.3 Dead Letter Queue

```typescript
interface DeadLetterMessage {
  id: string;
  originalQueue: string;
  messageType: string;
  payload: any;
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

class DeadLetterHandler {
  constructor(
    private db: D1Database,
    private queue: Queue
  ) {}

  async moveToDeadLetter(
    message: any,
    error: string,
    originalQueue: string
  ): Promise<void> {
    const dlMessage: DeadLetterMessage = {
      id: crypto.randomUUID(),
      originalQueue,
      messageType: message.type,
      payload: message,
      error,
      attempts: message._attempts || 1,
      firstFailedAt: new Date().toISOString(),
      lastFailedAt: new Date().toISOString(),
    };

    await this.db.prepare(`
      INSERT INTO dead_letter_queue
      (id, original_queue, message_type, payload, error, attempts, first_failed_at, last_failed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      dlMessage.id,
      dlMessage.originalQueue,
      dlMessage.messageType,
      JSON.stringify(dlMessage.payload),
      dlMessage.error,
      dlMessage.attempts,
      dlMessage.firstFailedAt,
      dlMessage.lastFailedAt
    ).run();

    // Alert admins
    await this.queue.send({
      type: 'admin_alert',
      alertType: 'dead_letter',
      messageId: dlMessage.id,
    });
  }

  async replayMessage(messageId: string): Promise<void> {
    const message = await this.db.prepare(
      'SELECT * FROM dead_letter_queue WHERE id = ?'
    ).bind(messageId).first<DeadLetterMessage>();

    if (!message) {
      throw new Error('Message not found');
    }

    // Re-queue the message
    await this.queue.send({
      ...JSON.parse(message.payload),
      _replayed: true,
      _originalDLId: messageId,
    });

    // Mark as replayed
    await this.db.prepare(
      'UPDATE dead_letter_queue SET replayed_at = ? WHERE id = ?'
    ).bind(new Date().toISOString(), messageId).run();
  }

  async getDeadLetters(limit = 100): Promise<DeadLetterMessage[]> {
    const result = await this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE replayed_at IS NULL
      ORDER BY last_failed_at DESC
      LIMIT ?
    `).bind(limit).all<DeadLetterMessage>();

    return result.results;
  }
}
```

### 6.4 Dead Letter Queue Schema

```sql
CREATE TABLE dead_letter_queue (
    id TEXT PRIMARY KEY,
    original_queue TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload TEXT NOT NULL,            -- JSON
    error TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    first_failed_at TEXT NOT NULL,
    last_failed_at TEXT NOT NULL,
    replayed_at TEXT,
    resolved_at TEXT,
    resolved_by TEXT,
    resolution_notes TEXT
);

CREATE INDEX idx_dlq_replayed ON dead_letter_queue(replayed_at) WHERE replayed_at IS NULL;
CREATE INDEX idx_dlq_type ON dead_letter_queue(message_type);
```

---

## 7. API Endpoints

### 7.1 Admin Dashboard API

```typescript
// GET /api/admin/dashboard
interface AdminDashboardResponse {
  health: {
    uptime: number;
    errorRate: number;
    avgLatencyMs: number;
  };
  costs: {
    today: number;
    thisMonth: number;
    projected: number;
    budget: number;
  };
  storage: {
    totalTB: number;
    usedTB: number;
    growthRatePercent: number;
  };
  processing: {
    queueDepth: number;
    activeJobs: number;
    failedToday: number;
    completedToday: number;
  };
  infrastructure: {
    runpod: { status: string; activeJobs: number };
    workers: { status: string; requests24h: number };
    d1: { status: string; sizeGB: number };
    queues: { status: string; depth: number };
  };
}

// GET /api/admin/costs?period=2025-01
// GET /api/admin/costs/forecast
// GET /api/admin/jobs
// GET /api/admin/jobs/:id
// POST /api/admin/jobs/:id/retry
// POST /api/admin/jobs/:id/cancel
// GET /api/admin/dead-letter
// POST /api/admin/dead-letter/:id/replay
// GET /api/admin/feature-flags
// PUT /api/admin/feature-flags/:id
// GET /api/admin/users/:id/usage
```

### 7.2 User Dashboard API

```typescript
// GET /api/me/dashboard
interface UserDashboardResponse {
  subscription: {
    tier: string;
    status: string;
    periodEnd: string;
  };
  usage: {
    storageGB: { used: number; limit: number };
    uploadMinutes: { used: number; limit: number };
    transcriptionMinutes: { used: number; limit: number };
    bandwidthGB: { used: number; limit: number | null };
  };
  costs: {
    basePlanCents: number;
    overageCents: number;
    totalCents: number;
  };
  features: {
    transcription: boolean;
    aiSearch: boolean;
    liveStreaming: boolean;
    // ...
  };
}

// GET /api/me/videos/:id/cost
// GET /api/me/invoices
// GET /api/me/invoices/:id
// PUT /api/me/features/:featureName  (toggle on/off)
// PUT /api/me/subscription (upgrade/downgrade)
```

---

## 8. Admin App (New Monorepo App)

### 8.1 App Structure

Add new app to monorepo: `apps/admin`

```
apps/
├── web/              # Public frontend
├── api-videos/       # Video API
├── processor/        # Queue processor
├── websocket-server/ # Real-time
└── admin/            # NEW: Admin dashboard
    ├── src/
    │   ├── app/
    │   │   ├── (dashboard)/
    │   │   │   ├── page.tsx           # Overview dashboard
    │   │   │   ├── costs/page.tsx     # Real-time cost tracking
    │   │   │   ├── users/page.tsx     # User management
    │   │   │   ├── features/page.tsx  # System toggles
    │   │   │   ├── jobs/page.tsx      # RunPod job management
    │   │   │   ├── queues/page.tsx    # Dead letter queue
    │   │   │   └── infrastructure/page.tsx
    │   │   └── api/                   # Admin-only API routes
    │   ├── components/
    │   └── lib/
    ├── wrangler.jsonc
    └── package.json
```

### 8.2 Real-Time Cost Estimation Dashboard

```typescript
// Admin sees costs calculated in real-time from collected metrics

interface RealTimeCostDashboard {
  // Current period (updates every minute)
  currentPeriod: {
    month: string;  // '2025-01'
    daysElapsed: number;
    daysRemaining: number;
  };

  // Actual costs so far (from metrics)
  actualCosts: {
    storage: { bytes: number; costCents: number };
    bandwidth: { bytes: number; costCents: number };
    transcription: { minutes: number; costCents: number };
    embedding: { tokens: number; costCents: number };
    gpu: { seconds: number; costCents: number };
    d1: { reads: number; writes: number; costCents: number };
    vectorize: { queries: number; costCents: number };
  };

  // Projected end-of-month (linear extrapolation)
  projectedCosts: {
    storage: number;
    bandwidth: number;
    transcription: number;
    total: number;
  };

  // Budget comparison
  budget: {
    monthlyBudgetCents: number;
    currentSpendCents: number;
    projectedSpendCents: number;
    variance: number;  // positive = under budget
    alertLevel: 'ok' | 'warning' | 'critical';
  };

  // Revenue (from subscriptions)
  revenue: {
    activeSubscriptions: number;
    mrrCents: number;  // Monthly recurring revenue
    projectedOverageCents: number;
  };

  // Profit margin
  margin: {
    revenueCents: number;
    costCents: number;
    profitCents: number;
    marginPercent: number;
  };
}
```

### 8.3 Admin Dashboard UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AL UMMAH NOW - ADMIN DASHBOARD                     [Jan 2025] [Settings]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  REVENUE     │  │   COSTS      │  │   MARGIN     │  │   USERS      │    │
│  │  $4,523      │  │   $892       │  │   80.3%      │  │   1,234      │    │
│  │  MRR         │  │   MTD        │  │   ↑ 2.1%     │  │   active     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  REAL-TIME COST BREAKDOWN                              [Refresh 1m] │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  Component        Usage           Base Cost    +Markup    Total     │    │
│  │  ──────────────────────────────────────────────────────────────     │    │
│  │  Storage          30.2 TB         $302.00      +$75.50    $377.50   │    │
│  │  Bandwidth        4.5 TB          $45.00       +$9.00     $54.00    │    │
│  │  Transcription    2,340 min       $44.46       +$15.56    $60.02    │    │
│  │  AI Search        45,000 queries  $0.45        +$0.18     $0.63     │    │
│  │  GPU Time         234 hrs         $79.56       +$39.78    $119.34   │    │
│  │  D1 Database      12M reads       $12.00       +$3.00     $15.00    │    │
│  │  ──────────────────────────────────────────────────────────────     │    │
│  │  TOTAL MTD                        $483.47      +$143.02   $626.49   │    │
│  │  PROJECTED EOM                    $967         +$286      $1,253    │    │
│  │                                                                      │    │
│  │  Budget: $1,500/mo                                    [Under ✓]     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────┐  ┌────────────────────────────────────┐    │
│  │  SYSTEM TOGGLES            │  │  PROCESSING QUEUE                  │    │
│  │                            │  │                                    │    │
│  │  Transcription   [ON ▼]   │  │  Pending:      45                  │    │
│  │   Est: $120/mo            │  │  Processing:   3                   │    │
│  │                            │  │  Failed:       2  [View DLQ]       │    │
│  │  AI Search       [ON ▼]   │  │  Completed:    1,234 (today)       │    │
│  │   Est: $15/mo             │  │                                    │    │
│  │                            │  │  RunPod Status: ● 2 active jobs   │    │
│  │  Auto Embedding  [ON ▼]   │  │  GPU Cost Today: $12.34           │    │
│  │   Est: $8/mo              │  │                                    │    │
│  └────────────────────────────┘  └────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  SUBSCRIPTION BREAKDOWN                                              │    │
│  │                                                                      │    │
│  │  Tier           Users    MRR        Avg Usage    Overage            │    │
│  │  ────────────────────────────────────────────────────────────────   │    │
│  │  Free           890      $0         2.1 GB       -                  │    │
│  │  Creator        234      $2,338     45 GB        $45                │    │
│  │  Professional   89       $2,669     280 GB       $120               │    │
│  │  Organization   12       $1,200     1.2 TB       $89                │    │
│  │  ────────────────────────────────────────────────────────────────   │    │
│  │  TOTAL          1,225    $6,207                  $254               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.4 Cost Calculation Cron Job

```typescript
// Run every minute to update real-time cost estimates
// apps/admin/src/lib/cost-calculator.ts

export async function calculateRealTimeCosts(env: Env): Promise<RealTimeCostDashboard> {
  const currentMonth = getCurrentMonth();  // '2025-01'
  const now = new Date();
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = now.getDate();

  // Fetch aggregated metrics from D1
  const metrics = await env.DB.prepare(`
    SELECT
      metric_type,
      SUM(value_bytes) as total_bytes,
      SUM(value_minutes) as total_minutes,
      SUM(value_seconds) as total_seconds,
      SUM(value_tokens) as total_tokens,
      SUM(value_requests) as total_requests
    FROM usage_metrics
    WHERE period = ?
    GROUP BY metric_type
  `).bind(currentMonth).all();

  // Calculate costs with markup
  const costs = calculateCostsFromMetrics(metrics.results);

  // Project end-of-month
  const projectionMultiplier = daysInMonth / daysElapsed;
  const projected = {
    storage: costs.storage.total,  // Storage doesn't grow linearly
    bandwidth: Math.ceil(costs.bandwidth.total * projectionMultiplier),
    transcription: Math.ceil(costs.transcription.total * projectionMultiplier),
    total: Math.ceil(costs.total * projectionMultiplier),
  };

  // Get budget
  const budget = await env.DB.prepare(
    'SELECT budget_cents FROM system_budgets WHERE period = ?'
  ).bind(currentMonth).first();

  // Get revenue
  const revenue = await calculateRevenue(env, currentMonth);

  return {
    currentPeriod: { month: currentMonth, daysElapsed, daysRemaining: daysInMonth - daysElapsed },
    actualCosts: costs,
    projectedCosts: projected,
    budget: {
      monthlyBudgetCents: budget?.budget_cents || 150000,  // Default $1500
      currentSpendCents: costs.total,
      projectedSpendCents: projected.total,
      variance: (budget?.budget_cents || 150000) - projected.total,
      alertLevel: getAlertLevel(projected.total, budget?.budget_cents || 150000),
    },
    revenue,
    margin: {
      revenueCents: revenue.mrrCents + revenue.projectedOverageCents,
      costCents: projected.total,
      profitCents: (revenue.mrrCents + revenue.projectedOverageCents) - projected.total,
      marginPercent: ((revenue.mrrCents - projected.total) / revenue.mrrCents) * 100,
    },
  };
}

function getAlertLevel(projected: number, budget: number): 'ok' | 'warning' | 'critical' {
  const ratio = projected / budget;
  if (ratio > 1) return 'critical';
  if (ratio > 0.8) return 'warning';
  return 'ok';
}
```

---

## 9. Audio Extraction Options

### 9.1 StreamPot (Open Source - Self-Hostable) ✅

**Note**: StreamPot was acquired by [ittybit.com](https://ittybit.com), but the **open-source version can still be self-hosted**.

[StreamPot GitHub](https://github.com/StreamPot/StreamPot) - MIT Licensed, still available.

#### Self-Hosting Requirements

| Component | Requirement |
|-----------|-------------|
| Node.js | v20+ |
| Database | PostgreSQL |
| Cache | Redis |
| Processing | FFmpeg (Docker recommended) |
| Storage | S3-compatible (can use **Cloudflare R2**!) |

#### Installation

```bash
# Install server globally
npm add -g @streampot/server

# Configure environment
cat > .env << EOF
DATABASE_URL=postgres://user:pass@localhost:5432/streampot
REDIS_URL=redis://localhost:6379
S3_ACCESS_KEY=your_r2_access_key
S3_SECRET_KEY=your_r2_secret_key
S3_REGION=auto
S3_BUCKET_NAME=streampot-temp
S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
S3_PUBLIC_DOMAIN=https://pub-xxx.r2.dev
FFMPEG_STRATEGY=docker
EOF

# Pull FFmpeg Docker image
docker pull linuxserver/ffmpeg

# Initialize database
streampot migrate

# Start server
streampot serve --port=3000
```

#### Self-Hosting Cost

On Hetzner CX22 (€4.35/mo):
- 2 vCPU, 4GB RAM
- Audio extraction: ~50x realtime
- Can process ~100 videos/day continuously
- **Cost: €4-8/month**

### 9.2 Ittybit (StreamPot's Acquirer)

[ittybit.com](https://ittybit.com) - Managed media processing API.

#### Pricing (Credits-Based)

| Plan | Monthly | Credits | Overage |
|------|---------|---------|---------|
| Free | $0 | 5,000 | - |
| Startup | $20 | 20,000 | $1/1k credits |
| Scale | $100 | 100,000 | $1/1k credits |
| Custom | $1,000+ | Volume | $2/TB |

#### Credit Costs

| Task | Video | Audio |
|------|-------|-------|
| Source (transcode/extract) | 5 credits/min | 2 credits/min |
| Intelligence (transcription) | 10 credits/min | 5 credits/min |
| Storage | 30 credits/GB-month | |
| CDN Bandwidth | 10 credits/GB | |

**Effective pricing**:
- Audio extraction: ~$0.002/min
- Transcription: ~$0.005/min (if they offer Whisper)
- Storage: ~$0.03/GB/month

#### For 200,000 Videos (avg 1.5 hrs)

```
Audio extraction: 200,000 × 90 min × 2 credits = 36M credits
At $1/1k credits = $36,000

vs Self-hosted StreamPot: ~€50/year
```

**Verdict**: Self-host StreamPot, don't use ittybit for extraction.

### 9.3 Comparison

| Option | Setup | Audio Extract Cost | Transcription |
|--------|-------|-------------------|---------------|
| **StreamPot (self-hosted)** | Medium | €4-8/mo | ❌ No |
| **Ittybit** | Easy | $36,000 (200k videos) | ⚠️ Maybe |
| **RunPod FFmpeg** | Easy | ~$600 one-time | ✅ Yes (Whisper) |
| **Cloudflare Stream** | Easy | Included | ✅ Yes (captions) |

### 9.4 Recommended Architecture

Use **StreamPot (self-hosted)** + **RunPod (Whisper only)**:

```
Video Upload (Bunny.net)
         │
         ▼
┌─────────────────────┐
│  StreamPot          │  Self-hosted on Hetzner €4/mo
│  (FFmpeg)           │  Uses R2 for temp storage
│                     │  Extracts audio only
└──────────┬──────────┘
           │ Audio file (in R2)
           ▼
┌─────────────────────┐
│  RunPod             │  GPU, pay-per-use $0.34/hr
│  (Whisper large-v3) │  30x realtime transcription
└──────────┬──────────┘
           │ Transcript JSON
           ▼
┌─────────────────────┐
│  Cloudflare         │
│  Workers AI (bge-m3)│  Generate embeddings
│  Vectorize          │  Index for search
│  D1                 │  Store transcript
└─────────────────────┘
```

**Total cost for 200,000 videos**:
- StreamPot server: €50/year
- RunPod GPU: ~$3,400 one-time
- **Total: ~$3,450** vs $36,000+ with managed services

### 9.5 StreamPot Integration Code

```typescript
import StreamPot from '@streampot/client';

// Connect to self-hosted instance
const client = new StreamPot({
  baseUrl: 'https://streampot.alummahnow.net'
});

async function extractAudio(videoUrl: string): Promise<string> {
  const job = await client
    .input(videoUrl)
    .noVideo()
    .audioCodec('libopus')
    .audioBitrate('64k')
    .format('webm')
    .output('audio.webm')
    .run();

  // Poll for completion
  let status = await client.getJob(job.id);
  while (status.status !== 'completed') {
    await sleep(2000);
    status = await client.getJob(job.id);
  }

  return status.output_url;  // R2 URL
}

// Queue integration
async function onVideoUploaded(videoId: string, bunnyUrl: string) {
  // 1. Extract audio via StreamPot
  const audioUrl = await extractAudio(bunnyUrl);

  // 2. Queue transcription job for RunPod
  await env.TRANSCRIPTION_QUEUE.send({
    type: 'transcribe',
    videoId,
    audioUrl,
  });
}
```

---

## 10. Implementation Phases (Revised)

### Phase 1: Metrics Collection (Week 1-2)
- [ ] D1 schema for usage_metrics table
- [ ] Rate tables and markup configuration
- [ ] Metrics collection in api-videos (upload, view events)
- [ ] Metrics collection in processor (transcription, embeddings)

### Phase 2: Admin App Setup (Week 3-4)
- [ ] Create apps/admin in monorepo
- [ ] Next.js 15 + Cloudflare Workers setup
- [ ] Admin authentication (separate from user auth)
- [ ] Real-time cost calculation dashboard
- [ ] System toggles UI (transcription, AI search on/off)

### Phase 3: Subscription & Quotas (Week 5-6)
- [ ] Subscription tier definitions (Free, Creator, Professional, Organization)
- [ ] Quota enforcement (videos/week, live streams/week, storage)
- [ ] Tier feature gating (sections, shorts, community, etc.)
- [ ] Stripe integration for payments
- [ ] User billing dashboard

### Phase 4: Infrastructure Orchestration (Week 7-8)
- [ ] StreamPot self-hosting setup (audio extraction)
- [ ] RunPod integration (Whisper transcription)
- [ ] Job queue management with priorities
- [ ] Webhook handlers for job completion
- [ ] Admin job management UI

### Phase 5: Resilience & Monitoring (Week 9-10)
- [ ] Circuit breakers for external services
- [ ] Retry logic with exponential backoff
- [ ] Dead letter queue with admin replay
- [ ] Budget alerts and notifications
- [ ] Cost anomaly detection

### Phase 6: Polish & Documentation (Week 11-12)
- [ ] Cost forecasting and projections
- [ ] Revenue analytics and margin tracking
- [ ] Billing reports and invoices
- [ ] Admin and API documentation
- [ ] Load testing and optimization

---

## References

- [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [RunPod API Documentation](https://docs.runpod.io/serverless/endpoints/)
- [StreamPot GitHub](https://github.com/StreamPot/StreamPot) - Open-source FFmpeg API
- [StreamPot Docs](https://docs.streampot.io/installation)
- [Stripe Subscriptions](https://stripe.com/docs/billing/subscriptions)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
