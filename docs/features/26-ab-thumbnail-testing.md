# A/B Thumbnail Testing - Implementation Plan

**Document Version**: 1.0
**Created**: 2025-11-20
**Priority**: LOW (Phase 4 - Platform Maturity)
**Estimated Effort**: 3-4 weeks
**Team Size**: 2 developers
**Dependencies**: Feature #6 (Custom Thumbnail During Upload)

---

## Executive Summary

This document outlines the complete implementation plan for A/B thumbnail testing, allowing creators to upload multiple thumbnail variations and use data-driven analytics to determine which thumbnail drives the highest click-through rate (CTR). This is an advanced optimization feature targeting power users and data-driven content creators.

**Key Goals**:
- Upload multiple thumbnail variations (2-4 variants)
- Automatically distribute variants across video impressions
- Track CTR (Click-Through Rate) for each variant
- Analytics dashboard showing performance comparison
- Select winning thumbnail based on statistical significance
- Support for time-bound tests (e.g., 7 days, 1000 impressions)

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Proposed Solution Architecture](#proposed-solution-architecture)
3. [Data Model Design](#data-model-design)
4. [A/B Testing Algorithm](#ab-testing-algorithm)
5. [Analytics Tracking System](#analytics-tracking-system)
6. [Statistical Significance Calculation](#statistical-significance-calculation)
7. [Results Dashboard](#results-dashboard)
8. [API Design](#api-design)
9. [Technical Implementation Details](#technical-implementation-details)
10. [Files to Create/Modify](#files-to-createmodify)
11. [Testing Strategy](#testing-strategy)
12. [Security & Privacy Considerations](#security--privacy-considerations)
13. [Performance Optimization](#performance-optimization)
14. [Success Metrics](#success-metrics)

---

## Current State Analysis

### Current Thumbnail System

**Single Thumbnail Approach**:
- Each video has one `thumbnailUrl` field
- No support for multiple variants
- No tracking of thumbnail impressions or clicks
- No A/B testing infrastructure

**Existing Analytics**:
- Video views tracked (total count)
- No impression tracking (how many times thumbnail was shown)
- No CTR metrics
- No thumbnail-specific analytics

**Pain Points**:
- Creators guess which thumbnail works best
- No data-driven thumbnail optimization
- Cannot test thumbnail effectiveness
- Missed opportunity to improve CTR by 10-50% (industry data)

---

## Proposed Solution Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│          Creator Upload Workflow                        │
├───────────────────────────────────────────────────────────┤
│  1. Upload video + metadata                              │
│  2. Upload thumbnail variants (2-4 images)               │
│  3. Configure test parameters:                           │
│     - Test duration (7/14/30 days)                       │
│     - Max impressions (1000/5000/10000)                  │
│     - Traffic split (equal or weighted)                  │
│  4. Start A/B test                                       │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│           A/B Test Distribution Engine                   │
├───────────────────────────────────────────────────────────┤
│  • Hash-based consistent assignment (userId → variant)   │
│  • Anonymous users: Random selection                     │
│  • Respect test duration and impression limits           │
│  • Equal traffic split (50/50, 33/33/33, etc.)          │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│          Impression & Click Tracking                     │
├───────────────────────────────────────────────────────────┤
│  Impression: When thumbnail shown in feed/search         │
│  Click: When user clicks thumbnail to watch video        │
│  • Queue events to processor                             │
│  • Aggregate in R2 (daily batches)                       │
│  • Calculate CTR: (clicks / impressions) * 100           │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│        Statistical Significance Analysis                 │
├───────────────────────────────────────────────────────────┤
│  • Chi-squared test for significance (p < 0.05)          │
│  • Minimum sample size: 100 impressions per variant      │
│  • 95% confidence intervals                              │
│  • Winner declaration criteria                           │
└───────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│          Analytics Dashboard (Creator View)              │
├───────────────────────────────────────────────────────────┤
│  • Variant performance comparison (CTR, clicks, views)   │
│  • Visual charts (bar chart, timeline)                   │
│  • Statistical significance indicator                    │
│  • "Select Winner" action (promote variant)              │
│  • Stop test early option                                │
└───────────────────────────────────────────────────────────┘
```

### Technical Architecture

**Frontend Components**:
- Thumbnail variant uploader (multi-file)
- A/B test configuration form
- Analytics dashboard (charts + tables)
- Winner selection UI

**Backend Services**:
- Thumbnail variant API (upload/list/delete)
- A/B test management API (start/stop/status)
- Impression tracking (queue-based)
- Click tracking (queue-based)
- Analytics aggregation service
- Statistical significance calculator

**Data Storage**:
- **R2 Bucket**: `thumbnail-variants` (stores all variant images)
- **R2 Bucket**: `ab-test-metrics` (aggregated daily metrics per variant)
- **Video Metadata**: Extended with `abTest` object (active test config)
- **KV Store**: Optional for fast variant lookups (caching)

---

## Data Model Design

### 1. Video Model Extension

Extend the existing `VideoObject` type in `packages/shared-types/src/video.ts`:

```typescript
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // A/B Testing fields
  abTest?: ThumbnailABTest | null;
  thumbnailVariants?: ThumbnailVariant[];
}

export interface ThumbnailABTest {
  id: string;                      // Test ID (unique)
  status: ABTestStatus;            // 'running' | 'completed' | 'stopped'
  startDate: string;               // ISO timestamp
  endDate?: string;                // ISO timestamp (null if no time limit)
  maxImpressions?: number;         // Stop test after N impressions (null = unlimited)
  variants: ThumbnailVariant[];    // 2-4 variants
  winnerVariantId?: string;        // Promoted winner (null during test)
  createdAt: string;
  updatedAt: string;
}

export interface ThumbnailVariant {
  id: string;                      // Variant ID (unique within test)
  name: string;                    // "Variant A", "Variant B", etc.
  thumbnailUrl: string;            // CDN URL for this variant
  thumbnailSizes: {                // Multiple sizes for responsiveness
    hd: string;                    // 1280x720
    sd: string;                    // 640x360
    mobile: string;                // 320x180
    thumb: string;                 // 120x90
  };
  trafficAllocation: number;       // Percentage (e.g., 50.0 for 50%)
  isControl: boolean;              // True for original thumbnail
  uploadedAt: string;
}

export type ABTestStatus =
  | 'draft'                        // Test configured but not started
  | 'running'                      // Active test
  | 'completed'                    // Test ended (time/impression limit)
  | 'stopped'                      // Manually stopped by creator
  | 'winner_selected';             // Winner promoted
```

### 2. Analytics Model

New type in `packages/shared-types/src/analytics.ts`:

```typescript
export interface ThumbnailABTestMetrics {
  testId: string;
  videoId: string;
  variants: VariantMetrics[];
  aggregatedAt: string;            // Last update timestamp
  testStatus: ABTestStatus;
  statisticalSignificance?: StatisticalSignificance;
}

export interface VariantMetrics {
  variantId: string;
  variantName: string;
  thumbnailUrl: string;

  // Core metrics
  impressions: number;             // Times shown in feed/search
  clicks: number;                  // Times clicked to watch video
  ctr: number;                     // (clicks / impressions) * 100

  // Engagement metrics (post-click)
  views: number;                   // Videos that started playing
  avgWatchTime?: number;           // Average watch time in seconds
  engagementRate?: number;         // (views / clicks) * 100

  // Time-series data
  dailyMetrics: DailyVariantMetrics[];
}

export interface DailyVariantMetrics {
  date: string;                    // YYYY-MM-DD
  impressions: number;
  clicks: number;
  ctr: number;
  views: number;
}

export interface StatisticalSignificance {
  isSignificant: boolean;          // p < 0.05
  pValue: number;                  // Chi-squared p-value
  confidenceLevel: number;         // 95% = 0.95
  winnerVariantId?: string;        // Variant with highest CTR (if significant)
  winnerCTR?: number;
  confidenceInterval: {            // 95% CI for winner
    lower: number;
    upper: number;
  };
  minimumSampleReached: boolean;   // At least 100 impressions per variant
  recommendation: string;          // Human-readable recommendation
}
```

### 3. Event Types

Extend `MessageType` enum in `apps/processor/src/types.ts`:

```typescript
export enum MessageType {
  // ... existing types ...

  // A/B Testing events
  ThumbnailImpression = 70,        // Thumbnail shown in feed
  ThumbnailClick = 71,             // Thumbnail clicked
  ABTestStarted = 72,              // A/B test initiated
  ABTestCompleted = 73,            // A/B test ended
  ABTestWinnerSelected = 74,       // Winner promoted
}
```

Event payload structures:

```typescript
export interface ThumbnailImpressionEvent {
  type: MessageType.ThumbnailImpression;
  videoId: string;
  variantId: string;               // Which variant was shown
  userId?: string;                 // Null for anonymous
  sessionId: string;               // Browser fingerprint
  context: ImpressionContext;      // Where shown (home, search, channel)
  timestamp: string;
}

export interface ThumbnailClickEvent {
  type: MessageType.ThumbnailClick;
  videoId: string;
  variantId: string;
  userId?: string;
  sessionId: string;
  context: ClickContext;
  impressionId?: string;           // Link to impression event
  timestamp: string;
}

export type ImpressionContext =
  | 'home_feed'
  | 'search_results'
  | 'channel_page'
  | 'playlist'
  | 'related_videos'
  | 'trending';

export type ClickContext = ImpressionContext;
```

---

## A/B Testing Algorithm

### Variant Assignment Strategy

**Consistent Hashing for Logged-in Users**:
```typescript
function assignVariant(
  userId: string,
  videoId: string,
  variants: ThumbnailVariant[]
): ThumbnailVariant {
  // Create deterministic hash from userId + videoId
  const hash = hashFunction(`${userId}-${videoId}`);

  // Map hash to variant index (0-based)
  const variantIndex = hash % variants.length;

  // Return assigned variant (user always sees same variant)
  return variants[variantIndex];
}
```

**Benefits**:
- Same user always sees same variant for a given video
- No need to store user-variant mapping
- Consistent experience across sessions
- No cookie dependency

**Random Assignment for Anonymous Users**:
```typescript
function assignVariantAnonymous(
  sessionId: string,
  videoId: string,
  variants: ThumbnailVariant[]
): ThumbnailVariant {
  // Use session ID for consistency within session
  const hash = hashFunction(`${sessionId}-${videoId}`);
  const variantIndex = hash % variants.length;
  return variants[variantIndex];
}
```

### Traffic Allocation

**Equal Split** (default):
- 2 variants: 50% / 50%
- 3 variants: 33.3% / 33.3% / 33.3%
- 4 variants: 25% / 25% / 25% / 25%

**Weighted Split** (advanced):
- Control (original): 50%
- Variant A: 30%
- Variant B: 20%

**Implementation**:
```typescript
function selectVariantWeighted(
  variants: ThumbnailVariant[],
  randomValue: number // 0-100
): ThumbnailVariant {
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.trafficAllocation;
    if (randomValue <= cumulative) {
      return variant;
    }
  }
  return variants[variants.length - 1]; // Fallback
}
```

### Test Termination Conditions

A/B test automatically stops when:
1. **Time Limit Reached**: `currentDate >= test.endDate`
2. **Impression Limit Reached**: `totalImpressions >= test.maxImpressions`
3. **Manual Stop**: Creator clicks "Stop Test"
4. **Statistical Significance Achieved**: Winner clear with p < 0.05 (optional auto-stop)

---

## Analytics Tracking System

### Impression Tracking

**When to Track Impression**:
- Thumbnail rendered in viewport (using Intersection Observer API)
- At least 50% of thumbnail visible for 1+ seconds
- Count once per session per video (avoid duplicate impressions)

**Frontend Implementation** (React hook):
```typescript
// apps/web/src/hooks/useImpressionTracking.ts
export function useImpressionTracking(
  videoId: string,
  variantId: string,
  context: ImpressionContext
) {
  const [tracked, setTracked] = useState(false);
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (tracked) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            // Wait 1 second before tracking
            setTimeout(() => {
              if (entry.isIntersecting) {
                trackImpression(videoId, variantId, context);
                setTracked(true);
              }
            }, 1000);
          }
        });
      },
      { threshold: 0.5 }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [videoId, variantId, context, tracked]);

  return elementRef;
}

async function trackImpression(
  videoId: string,
  variantId: string,
  context: ImpressionContext
) {
  const sessionId = getOrCreateSessionId(); // From localStorage
  const userId = getCurrentUserId(); // From auth context (null if anonymous)

  await fetch('/api/analytics/impression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      variantId,
      userId,
      sessionId,
      context,
      timestamp: new Date().toISOString(),
    }),
  });
}
```

### Click Tracking

**When to Track Click**:
- User clicks thumbnail to navigate to watch page
- Before navigation (send beacon or await fetch)

**Frontend Implementation**:
```typescript
function handleThumbnailClick(
  videoId: string,
  variantId: string,
  context: ClickContext
) {
  const sessionId = getOrCreateSessionId();
  const userId = getCurrentUserId();

  // Send tracking event (use sendBeacon for reliability)
  navigator.sendBeacon(
    '/api/analytics/click',
    JSON.stringify({
      videoId,
      variantId,
      userId,
      sessionId,
      context,
      timestamp: new Date().toISOString(),
    })
  );

  // Navigate to video
  router.push(`/watch/${videoId}`);
}
```

### Backend Processing

**Queue-based Aggregation**:
1. Frontend sends impression/click events to API
2. API validates and queues events (Cloudflare Queue)
3. Processor consumes events in batches
4. Aggregates metrics in R2 (daily buckets)
5. Calculates CTR and statistical significance

**Processor Handler** (`apps/processor/src/handlers/ab-test.ts`):
```typescript
export async function processABTestEvent(
  message: AlUmmahMessage,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  const { type, payload } = message;

  switch (type) {
    case MessageType.ThumbnailImpression:
      await handleImpressionEvent(payload, env, logger);
      break;
    case MessageType.ThumbnailClick:
      await handleClickEvent(payload, env, logger);
      break;
  }
}

async function handleImpressionEvent(
  payload: ThumbnailImpressionEvent,
  env: QueueEnvironment,
  logger: Logger
): Promise<void> {
  const { videoId, variantId, timestamp } = payload;
  const date = new Date(timestamp).toISOString().split('T')[0]; // YYYY-MM-DD

  // R2 key: ab-test-metrics/{videoId}/{date}.json
  const key = `ab-test-metrics/${videoId}/${date}.json`;

  // Fetch existing metrics for this day
  const existing = await env.AB_TEST_METRICS.get(key);
  const metrics: DailyABTestMetrics = existing
    ? JSON.parse(await existing.text())
    : { date, videoId, variants: {} };

  // Increment impression count for variant
  if (!metrics.variants[variantId]) {
    metrics.variants[variantId] = { impressions: 0, clicks: 0 };
  }
  metrics.variants[variantId].impressions++;

  // Save back to R2
  await env.AB_TEST_METRICS.put(key, JSON.stringify(metrics));

  logger.info(`Impression tracked: video=${videoId}, variant=${variantId}`);
}
```

---

## Statistical Significance Calculation

### Chi-Squared Test for A/B Testing

**Purpose**: Determine if observed CTR differences are statistically significant or due to random chance.

**Hypotheses**:
- **H0 (Null)**: All variants have the same CTR (no difference)
- **H1 (Alternative)**: At least one variant has a different CTR

**Formula**:
```
χ² = Σ [(Observed - Expected)² / Expected]
```

**Implementation** (`apps/processor/src/lib/statistics/chi-squared.ts`):
```typescript
export interface ChiSquaredResult {
  chiSquared: number;
  pValue: number;
  degreesOfFreedom: number;
  isSignificant: boolean; // p < 0.05
}

export function calculateChiSquared(
  variants: VariantMetrics[]
): ChiSquaredResult {
  const n = variants.length;
  const totalImpressions = variants.reduce((sum, v) => sum + v.impressions, 0);
  const totalClicks = variants.reduce((sum, v) => sum + v.clicks, 0);

  // Overall CTR (expected rate)
  const overallCTR = totalClicks / totalImpressions;

  // Calculate chi-squared statistic
  let chiSquared = 0;
  for (const variant of variants) {
    const expectedClicks = variant.impressions * overallCTR;
    const expectedNonClicks = variant.impressions * (1 - overallCTR);

    const observedClicks = variant.clicks;
    const observedNonClicks = variant.impressions - variant.clicks;

    // Chi-squared contributions
    chiSquared += Math.pow(observedClicks - expectedClicks, 2) / expectedClicks;
    chiSquared += Math.pow(observedNonClicks - expectedNonClicks, 2) / expectedNonClicks;
  }

  // Degrees of freedom = (rows - 1) * (cols - 1) = (2 - 1) * (n - 1) = n - 1
  const degreesOfFreedom = n - 1;

  // Calculate p-value using chi-squared distribution
  const pValue = chiSquaredCDF(chiSquared, degreesOfFreedom);

  return {
    chiSquared,
    pValue,
    degreesOfFreedom,
    isSignificant: pValue < 0.05, // 95% confidence
  };
}

// Chi-squared CDF approximation (or use library like jStat)
function chiSquaredCDF(x: number, df: number): number {
  // Use incomplete gamma function or numerical approximation
  // For simplicity, integrate with existing stats library
  return jStat.chisquare.cdf(x, df);
}
```

### Confidence Intervals

**95% Confidence Interval for CTR**:
```typescript
export function calculateCTRConfidenceInterval(
  clicks: number,
  impressions: number,
  confidenceLevel: number = 0.95
): { lower: number; upper: number } {
  const ctr = clicks / impressions;
  const z = 1.96; // 95% confidence (z-score)

  // Standard error for proportion
  const se = Math.sqrt((ctr * (1 - ctr)) / impressions);

  // Margin of error
  const margin = z * se;

  return {
    lower: Math.max(0, (ctr - margin) * 100), // Convert to percentage
    upper: Math.min(100, (ctr + margin) * 100),
  };
}
```

### Minimum Sample Size

**Requirement**: At least 100 impressions per variant for reliable results.

```typescript
export function hasMinimumSample(variants: VariantMetrics[]): boolean {
  return variants.every(v => v.impressions >= 100);
}
```

### Winner Selection Criteria

A variant is declared the "winner" if:
1. Chi-squared test shows p < 0.05 (statistically significant)
2. Minimum sample size reached (100+ impressions per variant)
3. Variant has highest CTR among all variants
4. CTR improvement is at least 5% over control (practical significance)

```typescript
export function selectWinner(
  variants: VariantMetrics[],
  chiSquaredResult: ChiSquaredResult
): string | null {
  if (!chiSquaredResult.isSignificant) return null;
  if (!hasMinimumSample(variants)) return null;

  // Find variant with highest CTR
  const sorted = [...variants].sort((a, b) => b.ctr - a.ctr);
  const winner = sorted[0];
  const control = variants.find(v => v.variantId === 'control');

  // Check practical significance (at least 5% improvement)
  if (control && winner.ctr < control.ctr * 1.05) return null;

  return winner.variantId;
}
```

---

## Results Dashboard

### Creator Analytics Page

**Route**: `/studio/videos/[videoId]/analytics/ab-test`

**Components**:
1. **Test Overview Card**:
   - Test status (running/completed/stopped)
   - Duration (days elapsed / remaining)
   - Total impressions across all variants
   - Statistical significance indicator

2. **Variant Comparison Table**:
   ```
   | Variant | Thumbnail | Impressions | Clicks | CTR    | Views | Status       |
   |---------|-----------|-------------|--------|--------|-------|--------------|
   | A       | [img]     | 1,234       | 156    | 12.6%  | 145   | Winner ✓     |
   | B       | [img]     | 1,198       | 132    | 11.0%  | 128   | -            |
   | C       | [img]     | 1,209       | 118    | 9.8%   | 110   | -            |
   ```

3. **CTR Comparison Chart** (Bar chart):
   - X-axis: Variant names
   - Y-axis: CTR percentage
   - Error bars: 95% confidence intervals
   - Highlight winner in green

4. **Timeline Chart** (Line chart):
   - X-axis: Date
   - Y-axis: CTR
   - Multiple lines (one per variant)
   - Shows CTR trends over time

5. **Statistical Significance Panel**:
   ```
   Statistical Significance: Yes (p = 0.023)
   Confidence Level: 95%
   Winner: Variant A
   CTR Improvement: 14.5% over control
   Recommendation: Promote Variant A as primary thumbnail
   ```

6. **Action Buttons**:
   - "Select Winner" (promotes variant to primary thumbnail)
   - "Stop Test" (ends test early)
   - "Extend Test" (add more days/impressions)
   - "Download Report" (CSV export)

### UI Implementation

**Dashboard Component** (`apps/web/src/app/[locale]/studio/videos/[id]/analytics/ab-test/page.tsx`):
```typescript
import { useABTestMetrics } from '@/hooks/useABTestMetrics';
import { ABTestOverview } from '@/components/ABTest/Overview';
import { VariantTable } from '@/components/ABTest/VariantTable';
import { CTRChart } from '@/components/ABTest/CTRChart';
import { TimelineChart } from '@/components/ABTest/TimelineChart';
import { StatisticalPanel } from '@/components/ABTest/StatisticalPanel';

export default function ABTestAnalyticsPage({ params }: { params: { id: string } }) {
  const { data: metrics, isLoading, error } = useABTestMetrics(params.id);

  if (isLoading) return <ABTestDashboardSkeleton />;
  if (error) return <ErrorDisplay error={error} />;
  if (!metrics) return <NoABTestMessage />;

  return (
    <div className="space-y-6">
      <ABTestOverview test={metrics.test} />
      <VariantTable variants={metrics.variants} />
      <CTRChart variants={metrics.variants} />
      <TimelineChart variants={metrics.variants} />
      <StatisticalPanel significance={metrics.statisticalSignificance} />
      <ActionButtons testId={metrics.test.id} videoId={params.id} />
    </div>
  );
}
```

**Chart Library**: Use Chart.js or Recharts for visualizations

---

## API Design

### 1. Create A/B Test

**Endpoint**: `POST /api/videos/:videoId/ab-test`

**Request**:
```json
{
  "variants": [
    {
      "name": "Variant A",
      "thumbnailFile": "<base64 or multipart upload>",
      "isControl": true
    },
    {
      "name": "Variant B",
      "thumbnailFile": "<base64 or multipart upload>",
      "isControl": false
    }
  ],
  "maxImpressions": 5000,
  "durationDays": 14,
  "trafficAllocation": "equal" // or "weighted"
}
```

**Response**:
```json
{
  "success": true,
  "testId": "test-abc123",
  "variants": [
    {
      "variantId": "variant-001",
      "name": "Variant A",
      "thumbnailUrl": "https://cdn.example.com/thumbnails/...",
      "trafficAllocation": 50.0,
      "isControl": true
    },
    {
      "variantId": "variant-002",
      "name": "Variant B",
      "thumbnailUrl": "https://cdn.example.com/thumbnails/...",
      "trafficAllocation": 50.0,
      "isControl": false
    }
  ],
  "startDate": "2025-11-20T12:00:00Z",
  "endDate": "2025-12-04T12:00:00Z"
}
```

### 2. Get A/B Test Metrics

**Endpoint**: `GET /api/videos/:videoId/ab-test/metrics`

**Response**:
```json
{
  "success": true,
  "test": {
    "id": "test-abc123",
    "status": "running",
    "startDate": "2025-11-20T12:00:00Z",
    "endDate": "2025-12-04T12:00:00Z",
    "maxImpressions": 5000,
    "currentImpressions": 2847
  },
  "variants": [
    {
      "variantId": "variant-001",
      "variantName": "Variant A",
      "thumbnailUrl": "https://...",
      "impressions": 1423,
      "clicks": 179,
      "ctr": 12.58,
      "views": 165,
      "avgWatchTime": 342.5,
      "dailyMetrics": [
        { "date": "2025-11-20", "impressions": 234, "clicks": 28, "ctr": 11.97 },
        { "date": "2025-11-21", "impressions": 312, "clicks": 41, "ctr": 13.14 }
      ]
    },
    {
      "variantId": "variant-002",
      "variantName": "Variant B",
      "impressions": 1424,
      "clicks": 156,
      "ctr": 10.96,
      "views": 142,
      "avgWatchTime": 318.2,
      "dailyMetrics": [...]
    }
  ],
  "statisticalSignificance": {
    "isSignificant": true,
    "pValue": 0.032,
    "confidenceLevel": 0.95,
    "winnerVariantId": "variant-001",
    "winnerCTR": 12.58,
    "confidenceInterval": { "lower": 11.2, "upper": 14.1 },
    "minimumSampleReached": true,
    "recommendation": "Variant A shows 14.8% higher CTR than Variant B with 95% confidence. Consider promoting Variant A."
  }
}
```

### 3. Select Winner

**Endpoint**: `POST /api/videos/:videoId/ab-test/select-winner`

**Request**:
```json
{
  "winnerVariantId": "variant-001"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Variant A promoted as primary thumbnail",
  "video": {
    "id": "video-123",
    "thumbnailUrl": "https://cdn.example.com/thumbnails/variant-001.jpg"
  }
}
```

### 4. Stop A/B Test

**Endpoint**: `POST /api/videos/:videoId/ab-test/stop`

**Response**:
```json
{
  "success": true,
  "message": "A/B test stopped",
  "finalMetrics": { /* same as GET /metrics */ }
}
```

### 5. Track Impression

**Endpoint**: `POST /api/analytics/impression`

**Request**:
```json
{
  "videoId": "video-123",
  "variantId": "variant-001",
  "userId": "user-456", // nullable
  "sessionId": "session-789",
  "context": "home_feed",
  "timestamp": "2025-11-20T12:34:56Z"
}
```

**Response**:
```json
{
  "success": true,
  "tracked": true
}
```

### 6. Track Click

**Endpoint**: `POST /api/analytics/click`

**Request**: Same as impression

**Response**: Same as impression

---

## Technical Implementation Details

### Phase 1: Backend Infrastructure (Week 1)

**Tasks**:
1. **Extend Video Model**:
   - Add `abTest` and `thumbnailVariants` fields to `VideoObject`
   - Update R2 repository schema
   - Migration script (if needed)

2. **Create A/B Test API Endpoints**:
   - `POST /api/videos/:id/ab-test` - Create test
   - `GET /api/videos/:id/ab-test` - Get test status
   - `POST /api/videos/:id/ab-test/select-winner` - Promote variant
   - `POST /api/videos/:id/ab-test/stop` - Stop test

3. **Thumbnail Storage Service**:
   - Create `thumbnail-variants` R2 bucket
   - Upload handler for multiple thumbnails
   - Image processing (resize to multiple sizes)
   - CDN URL generation

4. **Variant Assignment Logic**:
   - Hash-based consistent assignment function
   - Traffic allocation algorithm (equal/weighted split)
   - Store test configuration in video metadata

**Files to Create**:
- `apps/api-videos/src/endpoints/video/ab-test/createTest.ts`
- `apps/api-videos/src/endpoints/video/ab-test/getMetrics.ts`
- `apps/api-videos/src/endpoints/video/ab-test/selectWinner.ts`
- `apps/api-videos/src/endpoints/video/ab-test/stopTest.ts`
- `apps/api-videos/src/lib/ab-test/variantAssignment.ts`
- `apps/api-videos/src/lib/ab-test/thumbnailProcessor.ts`

### Phase 2: Analytics Tracking (Week 2)

**Tasks**:
1. **Impression Tracking API**:
   - `POST /api/analytics/impression` endpoint
   - Validate and queue impression events
   - Rate limiting (max 100 impressions/sec per video)

2. **Click Tracking API**:
   - `POST /api/analytics/click` endpoint
   - Link clicks to impressions (via sessionId)
   - Queue click events

3. **Processor Event Handlers**:
   - Add `ThumbnailImpression` and `ThumbnailClick` message types
   - Handler functions in processor
   - Aggregate metrics daily in R2 (`ab-test-metrics` bucket)

4. **Statistical Calculation Service**:
   - Chi-squared test implementation
   - Confidence interval calculation
   - Winner selection logic
   - Scheduled job to recalculate significance daily

**Files to Create**:
- `apps/api-videos/src/endpoints/analytics/impression.ts`
- `apps/api-videos/src/endpoints/analytics/click.ts`
- `apps/processor/src/handlers/ab-test.ts`
- `apps/processor/src/lib/statistics/chi-squared.ts`
- `apps/processor/src/lib/statistics/confidenceInterval.ts`
- `apps/processor/src/lib/ab-test/aggregator.ts`

### Phase 3: Frontend Implementation (Week 3)

**Tasks**:
1. **A/B Test Setup UI**:
   - Multi-thumbnail uploader component
   - Test configuration form (duration, max impressions)
   - Variant naming and preview
   - "Start A/B Test" button

2. **Variant Selection Logic** (Client-side):
   - Fetch active A/B test config from API
   - Implement variant assignment (hash-based)
   - Render assigned variant in video cards
   - Fallback to primary thumbnail if no test active

3. **Impression Tracking Hook**:
   - `useImpressionTracking` React hook
   - Intersection Observer implementation
   - Debounce and deduplication logic
   - Send tracking events to backend

4. **Analytics Dashboard**:
   - Test overview card (status, progress)
   - Variant comparison table
   - CTR bar chart (with confidence intervals)
   - Timeline chart (CTR over time)
   - Statistical significance panel
   - Action buttons (select winner, stop test)

**Files to Create**:
- `apps/web/src/components/ABTest/Setup/index.tsx`
- `apps/web/src/components/ABTest/Setup/ThumbnailUploader.tsx`
- `apps/web/src/components/ABTest/Setup/ConfigForm.tsx`
- `apps/web/src/components/ABTest/Dashboard/index.tsx`
- `apps/web/src/components/ABTest/Dashboard/VariantTable.tsx`
- `apps/web/src/components/ABTest/Dashboard/CTRChart.tsx`
- `apps/web/src/components/ABTest/Dashboard/TimelineChart.tsx`
- `apps/web/src/components/ABTest/Dashboard/StatisticalPanel.tsx`
- `apps/web/src/hooks/useImpressionTracking.ts`
- `apps/web/src/hooks/useABTestMetrics.ts`
- `apps/web/src/lib/ab-test/variantAssignment.ts` (client version)
- `apps/web/src/app/[locale]/studio/videos/[id]/ab-test/page.tsx`

**Files to Modify**:
- `apps/web/src/components/VideoCard/index.tsx` (add variant selection)
- `apps/web/src/components/VideoGrid/index.tsx` (add impression tracking)
- `apps/web/src/app/[locale]/watch/[id]/page.tsx` (track clicks)

### Phase 4: Polish & Testing (Week 4)

**Tasks**:
1. **Error Handling**:
   - Graceful degradation (fallback to primary thumbnail)
   - Retry logic for failed tracking events
   - User-friendly error messages

2. **Performance Optimization**:
   - Image lazy loading for variants
   - Batch impression tracking (send every 10 impressions)
   - CDN caching for variant images
   - R2 metrics aggregation optimization

3. **Security & Privacy**:
   - Rate limiting on tracking endpoints
   - GDPR compliance (anonymous impression tracking)
   - Creator-only access to A/B test results
   - Input validation and sanitization

4. **Testing**:
   - Unit tests for statistical functions
   - Integration tests for API endpoints
   - E2E tests for dashboard workflow
   - Load testing (1000+ impressions/sec)

---

## Files to Create/Modify

### New Files (Backend)

**API Endpoints**:
1. `apps/api-videos/src/endpoints/video/ab-test/createTest.ts`
2. `apps/api-videos/src/endpoints/video/ab-test/getMetrics.ts`
3. `apps/api-videos/src/endpoints/video/ab-test/selectWinner.ts`
4. `apps/api-videos/src/endpoints/video/ab-test/stopTest.ts`
5. `apps/api-videos/src/endpoints/analytics/impression.ts`
6. `apps/api-videos/src/endpoints/analytics/click.ts`

**Services**:
7. `apps/api-videos/src/lib/ab-test/variantAssignment.ts`
8. `apps/api-videos/src/lib/ab-test/thumbnailProcessor.ts`
9. `apps/api-videos/src/lib/ab-test/testManager.ts`

**Processor**:
10. `apps/processor/src/handlers/ab-test.ts`
11. `apps/processor/src/lib/statistics/chi-squared.ts`
12. `apps/processor/src/lib/statistics/confidenceInterval.ts`
13. `apps/processor/src/lib/ab-test/aggregator.ts`

### New Files (Frontend)

**Components**:
14. `apps/web/src/components/ABTest/Setup/index.tsx`
15. `apps/web/src/components/ABTest/Setup/ThumbnailUploader.tsx`
16. `apps/web/src/components/ABTest/Setup/ConfigForm.tsx`
17. `apps/web/src/components/ABTest/Dashboard/index.tsx`
18. `apps/web/src/components/ABTest/Dashboard/VariantTable.tsx`
19. `apps/web/src/components/ABTest/Dashboard/CTRChart.tsx`
20. `apps/web/src/components/ABTest/Dashboard/TimelineChart.tsx`
21. `apps/web/src/components/ABTest/Dashboard/StatisticalPanel.tsx`
22. `apps/web/src/components/ABTest/Dashboard/ActionButtons.tsx`

**Hooks**:
23. `apps/web/src/hooks/useImpressionTracking.ts`
24. `apps/web/src/hooks/useABTestMetrics.ts`
25. `apps/web/src/hooks/useABTestActions.ts`

**Pages**:
26. `apps/web/src/app/[locale]/studio/videos/[id]/ab-test/page.tsx`

**Utilities**:
27. `apps/web/src/lib/ab-test/variantAssignment.ts`
28. `apps/web/src/lib/ab-test/sessionId.ts`

### Files to Modify

**Shared Types**:
1. `packages/shared-types/src/video.ts` (add A/B test types)
2. `packages/shared-types/src/analytics.ts` (add metrics types)

**Processor**:
3. `apps/processor/src/types.ts` (add new message types)
4. `apps/processor/src/messageProcessor.ts` (add A/B test handler)

**Frontend**:
5. `apps/web/src/components/VideoCard/index.tsx` (variant selection)
6. `apps/web/src/components/VideoGrid/index.tsx` (impression tracking)
7. `apps/web/src/app/[locale]/watch/[id]/page.tsx` (click tracking)
8. `apps/web/src/lib/api/videos.ts` (add A/B test API client)

**Backend**:
9. `apps/api-videos/src/index.ts` (register new endpoints)
10. `apps/api-videos/wrangler.toml` (add `thumbnail-variants` and `ab-test-metrics` buckets)

---

## Testing Strategy

### Unit Tests

**Statistical Functions**:
```typescript
// apps/processor/src/lib/statistics/__tests__/chi-squared.test.ts
describe('Chi-Squared Test', () => {
  test('detects significant difference (p < 0.05)', () => {
    const variants = [
      { impressions: 1000, clicks: 100, ctr: 10.0 }, // Control
      { impressions: 1000, clicks: 150, ctr: 15.0 }, // Winner
    ];
    const result = calculateChiSquared(variants);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  test('no significant difference with similar CTRs', () => {
    const variants = [
      { impressions: 1000, clicks: 100, ctr: 10.0 },
      { impressions: 1000, clicks: 105, ctr: 10.5 },
    ];
    const result = calculateChiSquared(variants);
    expect(result.isSignificant).toBe(false);
  });

  test('requires minimum sample size', () => {
    const variants = [
      { impressions: 50, clicks: 5, ctr: 10.0 }, // Below minimum (100)
      { impressions: 50, clicks: 10, ctr: 20.0 },
    ];
    expect(hasMinimumSample(variants)).toBe(false);
  });
});
```

**Variant Assignment**:
```typescript
// apps/api-videos/src/lib/ab-test/__tests__/variantAssignment.test.ts
describe('Variant Assignment', () => {
  test('consistent assignment for same user', () => {
    const variants = [
      { variantId: 'A', name: 'Variant A' },
      { variantId: 'B', name: 'Variant B' },
    ];
    const userId = 'user-123';
    const videoId = 'video-456';

    const assignment1 = assignVariant(userId, videoId, variants);
    const assignment2 = assignVariant(userId, videoId, variants);

    expect(assignment1.variantId).toBe(assignment2.variantId);
  });

  test('roughly equal distribution', () => {
    const variants = [
      { variantId: 'A', name: 'Variant A' },
      { variantId: 'B', name: 'Variant B' },
    ];
    const videoId = 'video-456';

    const counts = { A: 0, B: 0 };
    for (let i = 0; i < 1000; i++) {
      const userId = `user-${i}`;
      const assignment = assignVariant(userId, videoId, variants);
      counts[assignment.variantId]++;
    }

    // Expect 50/50 split ± 10%
    expect(counts.A).toBeGreaterThan(450);
    expect(counts.A).toBeLessThan(550);
    expect(counts.B).toBeGreaterThan(450);
    expect(counts.B).toBeLessThan(550);
  });
});
```

### Integration Tests

**API Endpoints**:
```typescript
// apps/api-videos/src/endpoints/video/ab-test/__tests__/createTest.test.ts
describe('POST /api/videos/:id/ab-test', () => {
  test('creates A/B test with 2 variants', async () => {
    const response = await fetch('/api/videos/video-123/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variants: [
          { name: 'Variant A', thumbnailFile: 'base64...' },
          { name: 'Variant B', thumbnailFile: 'base64...' },
        ],
        maxImpressions: 1000,
        durationDays: 7,
      }),
    });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.variants).toHaveLength(2);
    expect(data.variants[0].trafficAllocation).toBe(50.0);
  });

  test('rejects more than 4 variants', async () => {
    const response = await fetch('/api/videos/video-123/ab-test', {
      method: 'POST',
      body: JSON.stringify({
        variants: Array(5).fill({ name: 'Variant', thumbnailFile: 'base64...' }),
      }),
    });

    expect(response.status).toBe(400);
  });
});
```

### E2E Tests

**Complete Workflow**:
```typescript
// apps/web/e2e/ab-test.spec.ts
test('creator can set up and view A/B test results', async ({ page }) => {
  // 1. Navigate to video edit page
  await page.goto('/studio/videos/video-123');

  // 2. Navigate to A/B test tab
  await page.click('text=A/B Test');

  // 3. Upload thumbnail variants
  await page.setInputFiles('#variant-a-upload', 'thumbnail-a.jpg');
  await page.setInputFiles('#variant-b-upload', 'thumbnail-b.jpg');

  // 4. Configure test
  await page.fill('#max-impressions', '5000');
  await page.fill('#duration-days', '14');

  // 5. Start test
  await page.click('button:text("Start A/B Test")');

  // 6. Verify test started
  await expect(page.locator('text=Test Running')).toBeVisible();

  // 7. Navigate to analytics
  await page.click('text=View Analytics');

  // 8. Verify dashboard loads
  await expect(page.locator('.variant-table')).toBeVisible();
  await expect(page.locator('.ctr-chart')).toBeVisible();
});
```

### Load Testing

**Impression Tracking**:
```bash
# Use Apache Bench or k6 for load testing
k6 run load-test-impressions.js

# Target: 1000 impressions/second
# Acceptable latency: p95 < 100ms
```

---

## Security & Privacy Considerations

### 1. Authentication & Authorization

**Creator-Only Access**:
- Only video owner can create/view/manage A/B tests
- API endpoints protected with JWT authentication
- Validate `userId` matches video owner

**Implementation**:
```typescript
// apps/api-videos/src/endpoints/video/ab-test/createTest.ts
export class CreateABTest extends OpenAPIRoute {
  async handle(c: Context) {
    const auth = c.get('auth');
    const videoId = c.req.param('id');

    // Fetch video from R2
    const video = await videoRepo.getObject(videoId);
    if (!video) return c.json({ error: 'Video not found' }, 404);

    // Verify ownership
    if (video.userId !== auth.userId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Create A/B test...
  }
}
```

### 2. Rate Limiting

**Impression/Click Tracking**:
- Max 100 impressions/second per video
- Max 50 clicks/second per video
- Use Cloudflare Workers rate limiting

**Implementation**:
```typescript
// apps/api-videos/src/middleware/rateLimiter.ts
export async function rateLimitTracking(c: Context, next: Next) {
  const videoId = c.req.json().videoId;
  const key = `rate-limit:impression:${videoId}`;

  const count = await c.env.RATE_LIMIT_KV.get(key);
  if (count && parseInt(count) > 100) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await c.env.RATE_LIMIT_KV.put(key, (parseInt(count || '0') + 1).toString(), {
    expirationTtl: 1, // 1 second
  });

  await next();
}
```

### 3. GDPR Compliance

**Anonymous Tracking**:
- No PII collected in impression/click events
- `userId` is optional (null for anonymous users)
- `sessionId` is browser fingerprint (no cookies)
- No IP addresses stored

**Data Retention**:
- Aggregated metrics stored indefinitely
- Raw impression/click events deleted after 90 days
- Users can request data deletion (GDPR right to erasure)

### 4. Input Validation

**Thumbnail Upload**:
- Validate file type (JPG, PNG only)
- Max file size: 2MB per variant
- Image dimensions: 1280x720 (16:9)
- Scan for malware (optional: VirusTotal API)

**Test Configuration**:
- Max 4 variants
- Duration: 1-90 days
- Max impressions: 100-100,000

### 5. Data Integrity

**Prevent Manipulation**:
- Hash impression/click events (verify integrity)
- Detect bot traffic (user-agent filtering)
- Honeypot traps (hidden elements)
- Suspicious pattern detection (same user clicking 100+ times)

---

## Performance Optimization

### 1. Image CDN

**Bunny.net Integration**:
- Store thumbnail variants in Bunny.net Storage
- Use Bunny.net Image Optimizer for on-the-fly resizing
- CDN caching (max-age: 1 year)

**URL Structure**:
```
https://cdn.alummahnow.net/thumbnails/{videoId}/variant-{variantId}-{size}.jpg
```

### 2. Batch Impression Tracking

**Client-Side Batching**:
- Collect 10 impressions locally
- Send batch request to API
- Reduce API calls by 90%

**Implementation**:
```typescript
// apps/web/src/lib/ab-test/batchTracker.ts
class ImpressionBatcher {
  private queue: ImpressionEvent[] = [];
  private batchSize = 10;

  track(event: ImpressionEvent) {
    this.queue.push(event);
    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.queue.length === 0) return;

    await fetch('/api/analytics/impressions/batch', {
      method: 'POST',
      body: JSON.stringify({ impressions: this.queue }),
    });

    this.queue = [];
  }
}
```

### 3. R2 Metrics Aggregation

**Daily Pre-Aggregation**:
- Processor aggregates metrics daily (cron job)
- Avoids querying raw events on every API request
- Reduces R2 read operations by 99%

**Storage Structure**:
```
ab-test-metrics/
  {videoId}/
    {testId}/
      2025-11-20.json  (daily aggregate)
      2025-11-21.json
      summary.json     (current totals)
```

### 4. Lazy Loading

**Dashboard Charts**:
- Load charts on demand (click to expand)
- Paginate daily metrics (show last 7 days by default)
- Use virtual scrolling for long tables

---

## Success Metrics

### Key Performance Indicators

**Adoption Rate**:
- **Target**: 10% of creators with 10+ videos use A/B testing
- **Measurement**: `abTestsCreated / totalCreators * 100`

**Test Completion Rate**:
- **Target**: 80% of tests reach statistical significance
- **Measurement**: `testsWithSignificance / totalTests * 100`

**Average CTR Improvement**:
- **Target**: 15% average improvement from winner variant
- **Measurement**: `(winnerCTR - controlCTR) / controlCTR * 100`

**Engagement Impact**:
- **Target**: Videos with optimized thumbnails see 20% more views
- **Measurement**: Compare views before/after winner selection

### Analytics Tracking

**Events to Track**:
1. `ab_test_created` - Test initiated
2. `ab_test_variant_viewed` - Variant impression
3. `ab_test_variant_clicked` - Variant click
4. `ab_test_completed` - Test ended (time/impression limit)
5. `ab_test_winner_selected` - Winner promoted
6. `ab_test_stopped_early` - Manually stopped

**Dashboards**:
- Creator Studio: Individual test results
- Admin Analytics: Platform-wide A/B test metrics
- Aggregate CTR improvements across all tests

---

## Migration Plan

### For Existing Videos

**No Migration Required**:
- Existing videos keep current `thumbnailUrl`
- A/B testing is opt-in (creators manually initiate tests)
- No breaking changes to video model

### Rollout Strategy

**Beta Phase (Week 1-2)**:
- Enable for 5-10 selected creators (power users)
- Monitor for bugs and performance issues
- Gather feedback on UI/UX

**Gradual Rollout (Week 3-4)**:
- Enable for 25% of creators with 10+ videos
- Monitor system performance (API latency, R2 costs)
- Fix issues from beta

**Full Launch (Week 5)**:
- Enable for all creators
- Announce feature in creator newsletter
- Publish tutorial video and documentation

### Feature Flags

```typescript
// apps/web/src/lib/features.ts
export const FEATURES = {
  AB_THUMBNAIL_TESTING: process.env.NEXT_PUBLIC_AB_TEST === 'true',
};

// Usage in components
if (FEATURES.AB_THUMBNAIL_TESTING) {
  return <ABTestSetupButton />;
}
```

---

## Risk Analysis

### Technical Risks

**1. Statistical Complexity**:
- **Risk**: Incorrect chi-squared calculation leads to false positives/negatives
- **Mitigation**: Use proven statistical libraries (jStat), extensive unit tests

**2. Performance at Scale**:
- **Risk**: 1M+ impressions/day overwhelms queue and R2
- **Mitigation**: Batch aggregation, R2 pagination, caching

**3. Bot Traffic**:
- **Risk**: Automated bots skew impression/click data
- **Mitigation**: User-agent filtering, rate limiting, CAPTCHA for suspicious patterns

### Business Risks

**1. Low Adoption**:
- **Risk**: Creators don't understand or use A/B testing
- **Mitigation**: Tutorial video, in-app tooltips, email campaigns

**2. Analysis Paralysis**:
- **Risk**: Creators over-test and delay publishing
- **Mitigation**: Recommend 7-14 day tests, auto-stop at significance

**3. Privacy Concerns**:
- **Risk**: Users concerned about tracking
- **Mitigation**: Transparent privacy policy, anonymous tracking, GDPR compliance

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

**1. Auto-Generated Thumbnails**:
- AI extracts best frames from video
- Scene detection (faces, text, high contrast)
- Automatically create 3-4 variants

**2. Multi-Variate Testing**:
- Test thumbnails + titles simultaneously
- Test thumbnails + descriptions
- Combinatorial analysis

**3. Audience Segmentation**:
- Different thumbnails for different demographics
- Age-based variants
- Location-based variants (e.g., Arabic vs English thumbnails)

**4. Smart Recommendations**:
- ML model predicts winning thumbnail before test
- Suggest optimal test duration based on channel size
- Auto-select winner at statistical significance

**5. Competitive Analysis**:
- Compare your CTR to category average
- Benchmark against top performers
- Industry insights dashboard

---

## Conclusion

This implementation plan provides a comprehensive, data-driven approach to A/B thumbnail testing for Al Ummah Now. The solution balances technical complexity with user experience, ensuring creators can easily optimize their thumbnails while maintaining statistical rigor.

**Next Steps**:
1. Review and approve plan with team
2. Prioritize Phase 4 roadmap (after Phases 1-3 complete)
3. Allocate development resources (2 developers, 3-4 weeks)
4. Set up development environment (R2 buckets, queue configuration)
5. Begin Phase 1: Backend Infrastructure

**Estimated Timeline**: 3-4 weeks with 2 developers

**Success Criteria**:
- 10% creator adoption within 6 months
- 80% test completion rate
- 15% average CTR improvement

---

## References

### Academic Papers
- **A/B Testing Best Practices**: Google's "Overlapping Experiment Infrastructure"
- **Statistical Significance**: "Practical Guide to Controlled Experiments on the Web" (Kohavi et al.)
- **Chi-Squared Test**: "Pearson's Chi-Squared Test" (Wikipedia, verified)

### Industry Examples
- **YouTube**: A/B thumbnail testing (YouTube Studio feature)
- **Netflix**: Title artwork personalization (similar concept)
- **Facebook**: A/B testing for ad creatives

### Technical Documentation
- **Chi-Squared Distribution**: jStat library documentation
- **Intersection Observer API**: MDN Web Docs
- **Cloudflare Queues**: Cloudflare Workers documentation

---

**Document Maintained By**: Development Team
**Last Updated**: 2025-11-20
**Next Review**: After Phase 1 completion (or Q2 2026)
