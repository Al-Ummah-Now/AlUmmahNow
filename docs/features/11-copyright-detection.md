# Copyright Detection System Implementation Plan

**Document Version**: 1.0
**Created**: 2025-11-20
**Author**: System Architect
**Status**: Proposed

## Executive Summary

This document provides a comprehensive implementation plan for integrating a Copyright Detection System into the Al Ummah Now platform. The system will automatically scan uploaded videos for copyrighted content, provide various response options (block, track, allow), and include a dispute process for false positives.

**Estimated Timeline**: 6-8 weeks
**Estimated Cost**: $0.02-0.04 per video scan
**Priority**: HIGH (Legal compliance and platform protection)

## Table of Contents

1. [Business Requirements](#business-requirements)
2. [Third-Party API Evaluation](#third-party-api-evaluation)
3. [Architecture Design](#architecture-design)
4. [Queue-Based Processing](#queue-based-processing)
5. [Manual Review Dashboard](#manual-review-dashboard)
6. [Cost Analysis](#cost-analysis)
7. [Implementation Plan](#implementation-plan)
8. [Islamic Content Considerations](#islamic-content-considerations)
9. [Testing Strategy](#testing-strategy)
10. [Risk Assessment](#risk-assessment)

## Business Requirements

### Core Functionality
- Automatic copyright scanning before video publication
- Audio and video fingerprinting capabilities
- Match against copyrighted content database
- Multiple response options when matches found
- Dispute process for content creators
- Manual review system for edge cases

### User Stories
1. **As a content creator**, I want to know if my video contains copyrighted content before publishing, so I can avoid copyright strikes.
2. **As a platform administrator**, I want to automatically detect and handle copyrighted content to protect the platform from legal liability.
3. **As a content creator**, I want to dispute false copyright claims on my original content.
4. **As a copyright holder**, I want my content protected from unauthorized use on the platform.

## Third-Party API Evaluation

### 1. Audible Magic (Recommended)
**Pros:**
- Industry leader in content identification
- 14+ billion reference files
- Real-time scanning capability
- Audio and video fingerprinting
- Trusted by major platforms
- Islamic content database available

**Cons:**
- Higher cost ($0.03-0.05 per scan)
- Complex integration
- Requires business agreement

**API Features:**
- REST API with webhook callbacks
- Batch processing support
- Detailed match reports
- Custom policy configuration

### 2. ACRCloud
**Pros:**
- Cost-effective ($0.01-0.03 per scan)
- Good audio fingerprinting
- Easy integration
- Pay-as-you-go pricing
- 100M+ music database

**Cons:**
- Limited video capabilities
- Smaller reference database
- Less Islamic content coverage

**API Features:**
- RESTful API
- Real-time and batch modes
- Multi-language support
- Custom database option

### 3. Pex Attribution Engine
**Pros:**
- Modern API design
- Good for user-generated content
- Attribution focus (not just blocking)
- Reasonable pricing

**Cons:**
- Newer platform (less proven)
- Limited Islamic content
- Primarily music focused

### 4. YouTube Content ID API (Not Available)
**Note:** Only available to YouTube partners with significant content portfolios. Not an option for third-party platforms.

### Recommendation: Audible Magic
Based on comprehensive coverage, Islamic content support, and industry trust, Audible Magic is recommended despite higher costs.

## Architecture Design

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Upload Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Video Upload → 2. Queue Message → 3. Copyright Scan    │
│                                                             │
│  4. Process Results → 5. Apply Policy → 6. Notify Creator  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Component Architecture                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────┐ │
│  │   API Videos │────>│   Queue      │────>│ Processor  │ │
│  │   (Initiate) │     │  (Copyright) │     │  (Worker)  │ │
│  └──────────────┘     └──────────────┘     └────────────┘ │
│         │                                          │        │
│         │                                          ↓        │
│         │              ┌──────────────┐     ┌────────────┐ │
│         └─────────────>│  R2 Storage  │<────│ Audible    │ │
│                        │  (Results)   │     │   Magic    │ │
│                        └──────────────┘     └────────────┘ │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐                    │
│  │   Dashboard  │────>│  Manual      │                    │
│  │   (Review)   │     │   Review     │                    │
│  └──────────────┘     └──────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Upload Initiation**
   - Video uploaded via TUS protocol
   - Copyright scan job queued

2. **Fingerprint Generation**
   - Extract audio/video fingerprints
   - Send to Audible Magic API

3. **Match Processing**
   - Receive match results
   - Apply configured policies

4. **Policy Enforcement**
   - Block: Prevent publication
   - Track: Allow with monitoring
   - Monetize: Revenue sharing (future)

5. **Notification**
   - Notify creator of results
   - Provide dispute options

### Database Schema

```typescript
// Copyright Scan Result
interface CopyrightScanResult {
  id: string;
  videoId: string;
  scanDate: Date;
  status: 'pending' | 'scanning' | 'completed' | 'failed';
  provider: 'audible_magic' | 'acrcloud';
  matches: CopyrightMatch[];
  policy: CopyrightPolicy;
  reviewStatus: 'auto' | 'manual_review' | 'disputed' | 'resolved';
  disputeId?: string;
}

// Copyright Match
interface CopyrightMatch {
  matchId: string;
  contentType: 'audio' | 'video';
  confidenceScore: number; // 0-100
  matchedContent: {
    title: string;
    owner: string;
    duration: number;
    isrcCode?: string; // International Standard Recording Code
  };
  matchSegments: Array<{
    startTime: number;
    endTime: number;
    matchPercentage: number;
  }>;
  policy: 'block' | 'track' | 'monetize' | 'allow';
}

// Copyright Policy
interface CopyrightPolicy {
  action: 'block' | 'track' | 'monetize' | 'allow' | 'manual_review';
  reason?: string;
  appliedAt: Date;
  appliedBy: 'system' | 'admin' | string; // userId for manual
}

// Copyright Dispute
interface CopyrightDispute {
  id: string;
  videoId: string;
  scanResultId: string;
  userId: string;
  reason: 'fair_use' | 'original_content' | 'permission' | 'false_positive' | 'other';
  description: string;
  evidence?: string[]; // URLs to supporting documents
  status: 'pending' | 'under_review' | 'approved' | 'rejected';
  reviewNotes?: string;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}
```

## Queue-Based Processing

### Queue Configuration

```typescript
// Queue Name: al-ummah-now-copyright-scan
interface CopyrightScanMessage {
  type: 'COPYRIGHT_SCAN';
  videoId: string;
  fileUrl: string;
  userId: string;
  channelId: string;
  priority: 'high' | 'normal' | 'low';
  metadata: {
    title: string;
    description: string;
    duration: number;
    fileSize: number;
  };
  retryCount: number;
  maxRetries: 3;
}
```

### Processing Workflow

```typescript
// apps/processor/src/handlers/copyrightScan.ts
export async function handleCopyrightScan(message: CopyrightScanMessage) {
  const logger = getLogger('COPYRIGHT_SCAN');

  try {
    // 1. Initialize scan record
    const scanResult = await createScanRecord(message.videoId);

    // 2. Download video segment for fingerprinting
    const videoSegment = await downloadVideoSegment(message.fileUrl, {
      duration: 60, // First 60 seconds for initial scan
      quality: 'medium'
    });

    // 3. Generate fingerprints
    const fingerprints = await generateFingerprints(videoSegment);

    // 4. Call Audible Magic API
    const matches = await audibleMagicClient.scan({
      fingerprints,
      videoId: message.videoId,
      webhookUrl: `${API_URL}/webhook/copyright-result`
    });

    // 5. Process matches
    const policy = await determinePolicy(matches);

    // 6. Store results
    await storeScanResults(scanResult.id, {
      matches,
      policy,
      status: 'completed'
    });

    // 7. Apply policy
    await applyPolicy(message.videoId, policy);

    // 8. Notify creator
    await notifyCreator(message.userId, {
      videoId: message.videoId,
      scanResult,
      policy
    });

    logger.info('Copyright scan completed', {
      videoId: message.videoId,
      matchCount: matches.length,
      policy: policy.action
    });

  } catch (error) {
    logger.error('Copyright scan failed', {
      videoId: message.videoId,
      error: error.message
    });

    // Retry logic
    if (message.retryCount < message.maxRetries) {
      await requeueMessage({
        ...message,
        retryCount: message.retryCount + 1
      });
    } else {
      await markVideoForManualReview(message.videoId);
    }
  }
}
```

### Policy Engine

```typescript
// apps/processor/src/lib/copyright/policyEngine.ts
export function determinePolicy(matches: CopyrightMatch[]): CopyrightPolicy {
  // No matches - allow
  if (matches.length === 0) {
    return {
      action: 'allow',
      appliedAt: new Date(),
      appliedBy: 'system'
    };
  }

  // High confidence match - block
  const highConfidenceMatch = matches.find(m => m.confidenceScore > 95);
  if (highConfidenceMatch) {
    return {
      action: 'block',
      reason: `High confidence match: ${highConfidenceMatch.matchedContent.title}`,
      appliedAt: new Date(),
      appliedBy: 'system'
    };
  }

  // Multiple matches - manual review
  if (matches.length > 3) {
    return {
      action: 'manual_review',
      reason: 'Multiple copyright matches detected',
      appliedAt: new Date(),
      appliedBy: 'system'
    };
  }

  // Islamic content exceptions
  const islamicContent = matches.filter(m =>
    isIslamicContent(m.matchedContent.title)
  );

  if (islamicContent.length > 0) {
    return {
      action: 'manual_review',
      reason: 'Islamic content requires manual review',
      appliedAt: new Date(),
      appliedBy: 'system'
    };
  }

  // Default - track
  return {
    action: 'track',
    reason: 'Low confidence matches - tracking enabled',
    appliedAt: new Date(),
    appliedBy: 'system'
  };
}
```

## Manual Review Dashboard

### Dashboard Components

1. **Review Queue Page**
```typescript
// apps/web/src/app/[locale]/admin/copyright/page.tsx
- List of videos pending review
- Filters: date range, channel, match confidence
- Sort: priority, upload date, match count
- Bulk actions: approve all, reject all
```

2. **Review Detail Page**
```typescript
// apps/web/src/app/[locale]/admin/copyright/[scanId]/page.tsx
- Video preview player
- Match timeline visualization
- Matched content details
- Side-by-side comparison
- Action buttons: approve, block, request more info
```

3. **Dispute Management**
```typescript
// apps/web/src/app/[locale]/admin/copyright/disputes/page.tsx
- List of active disputes
- Dispute history
- Evidence review
- Communication with creator
- Resolution tracking
```

### UI Components

```typescript
// apps/web/src/components/admin/copyright/MatchTimeline.tsx
export function MatchTimeline({ matches, videoDuration }) {
  return (
    <div className="relative h-20 bg-gray-100 rounded">
      {matches.map(match => (
        <div
          key={match.matchId}
          className="absolute h-full bg-red-500 opacity-50"
          style={{
            left: `${(match.startTime / videoDuration) * 100}%`,
            width: `${((match.endTime - match.startTime) / videoDuration) * 100}%`
          }}
          title={`${match.matchedContent.title} (${match.confidenceScore}%)`}
        />
      ))}
    </div>
  );
}

// apps/web/src/components/admin/copyright/ReviewActions.tsx
export function ReviewActions({ scanId, videoId, onAction }) {
  return (
    <div className="flex gap-4">
      <button onClick={() => onAction('approve')} className="btn-primary">
        Approve & Publish
      </button>
      <button onClick={() => onAction('block')} className="btn-danger">
        Block Video
      </button>
      <button onClick={() => onAction('request_info')} className="btn-secondary">
        Request More Info
      </button>
      <button onClick={() => onAction('whitelist')} className="btn-outline">
        Whitelist Creator
      </button>
    </div>
  );
}
```

### API Endpoints

```typescript
// apps/api-videos/src/endpoints/copyright/review.ts
export const reviewEndpoints = [
  {
    method: 'GET',
    path: '/copyright/review/queue',
    handler: getReviewQueue,
    auth: 'admin'
  },
  {
    method: 'GET',
    path: '/copyright/review/:scanId',
    handler: getReviewDetail,
    auth: 'admin'
  },
  {
    method: 'POST',
    path: '/copyright/review/:scanId/action',
    handler: performReviewAction,
    auth: 'admin'
  },
  {
    method: 'GET',
    path: '/copyright/disputes',
    handler: getDisputes,
    auth: 'admin'
  },
  {
    method: 'POST',
    path: '/copyright/disputes/:disputeId/resolve',
    handler: resolveDispute,
    auth: 'admin'
  }
];
```

## Cost Analysis

### Pricing Breakdown

| Provider | Per-Scan Cost | Setup Fee | Monthly Minimum | Volume Discounts |
|----------|--------------|-----------|-----------------|------------------|
| Audible Magic | $0.03-0.05 | $5,000 | $500 | >100k scans: 20% off |
| ACRCloud | $0.01-0.03 | $0 | $100 | >50k scans: 15% off |
| Pex | $0.02-0.04 | $1,000 | $250 | Custom pricing >200k |

### Monthly Cost Projections

Assuming average upload volume:
- **Low Volume** (1,000 videos/month): $30-50
- **Medium Volume** (10,000 videos/month): $300-500
- **High Volume** (50,000 videos/month): $1,200-2,000
- **Very High** (100,000+ videos/month): $2,000-3,500 (with discounts)

### Cost Optimization Strategies

1. **Selective Scanning**
   - Skip trusted creators (whitelist)
   - Sample scanning for low-risk content
   - Full scan only for new users

2. **Tiered Scanning**
   - Quick scan (first 30 seconds): $0.01
   - Full scan (entire video): $0.05
   - Deep scan (frame-by-frame): $0.10

3. **Caching Results**
   - Cache fingerprints for re-uploads
   - Share results across similar videos
   - Batch processing for efficiency

### ROI Calculation

**Benefits:**
- Avoid legal costs: $10,000-100,000 per lawsuit
- Platform reputation: Invaluable
- Creator trust: Higher retention
- Ad revenue protection: Enable monetization

**Break-even:** ~20,000 videos/month justifies the system

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Tasks:**
1. Set up Audible Magic account and API access
2. Create copyright queue infrastructure
3. Implement basic scan result storage (R2)
4. Add copyright scan message type to processor

**Files to Create:**
```
apps/processor/src/handlers/copyrightScan.ts
apps/processor/src/lib/copyright/
  ├── audibleMagicClient.ts
  ├── policyEngine.ts
  └── fingerprinting.ts
apps/api-videos/src/lib/copyright/
  ├── repository.ts
  └── types.ts
packages/shared-types/src/copyright.ts
```

**Files to Modify:**
```
apps/processor/src/index.ts (add copyright handler)
apps/api-videos/src/endpoints/video/uploadComplete.ts (queue scan)
apps/processor/wrangler.toml (add copyright queue binding)
```

### Phase 2: Integration (Week 3-4)

**Tasks:**
1. Integrate Audible Magic API
2. Implement fingerprint generation
3. Create policy engine
4. Add scan status to video model

**Files to Create:**
```
apps/api-videos/src/endpoints/copyright/
  ├── scanStatus.ts
  ├── scanResults.ts
  └── webhook.ts
apps/processor/src/services/
  ├── videoDownloader.ts
  └── notificationService.ts
```

**Files to Modify:**
```
packages/shared-types/src/video.ts (add copyright fields)
apps/api-videos/src/endpoints/video/getVideo.ts (include scan status)
apps/web/src/components/videoUpload/index.tsx (show scan status)
```

### Phase 3: Dashboard (Week 5-6)

**Tasks:**
1. Build admin review dashboard
2. Implement dispute system
3. Create review workflow
4. Add notification system

**Files to Create:**
```
apps/web/src/app/[locale]/admin/copyright/
  ├── page.tsx (queue list)
  ├── [scanId]/page.tsx (detail view)
  └── disputes/page.tsx
apps/web/src/components/admin/copyright/
  ├── ReviewQueue.tsx
  ├── MatchTimeline.tsx
  ├── ReviewActions.tsx
  └── DisputeForm.tsx
apps/api-videos/src/endpoints/copyright/
  ├── review.ts
  └── dispute.ts
```

### Phase 4: Creator Experience (Week 7-8)

**Tasks:**
1. Add dispute UI for creators
2. Implement appeal process
3. Create help documentation
4. Add email notifications

**Files to Create:**
```
apps/web/src/app/[locale]/studio/disputes/
  ├── page.tsx
  └── [disputeId]/page.tsx
apps/web/src/components/studio/
  ├── DisputeStatus.tsx
  └── AppealForm.tsx
docs/help/copyright-disputes.md
```

## Islamic Content Considerations

### Special Cases

1. **Quran Recitations**
   - Many commercial recordings are copyrighted
   - Need database of public domain recitations
   - Consider fair use for educational content
   - Manual review for all Quran content

2. **Nasheed (Islamic Songs)**
   - Artist copyrights must be respected
   - Establish partnerships with nasheed artists
   - Create approved nasheed library
   - Revenue sharing options

3. **Lectures and Sermons**
   - Often include copyrighted nasheeds
   - May reference copyrighted video clips
   - Educational fair use considerations
   - Scholar permissions database

4. **Historical Content**
   - Archival footage copyright status
   - Documentary excerpts
   - News footage usage rights

### Islamic Fair Use Guidelines

```typescript
// apps/processor/src/lib/copyright/islamicFairUse.ts
export function evaluateIslamicFairUse(match: CopyrightMatch): boolean {
  const fairUseFactors = {
    educational: match.metadata?.purpose === 'educational',
    nonCommercial: !match.metadata?.monetized,
    transformative: match.matchPercentage < 10,
    shortDuration: match.duration < 30, // seconds
    attribution: match.metadata?.attribution !== null
  };

  // Quran recitation exception
  if (match.contentType === 'quran_recitation') {
    return fairUseFactors.educational && fairUseFactors.nonCommercial;
  }

  // Lecture excerpt exception
  if (match.contentType === 'lecture' && fairUseFactors.shortDuration) {
    return true;
  }

  // Educational commentary
  if (fairUseFactors.educational && fairUseFactors.transformative) {
    return true;
  }

  return false;
}
```

### Whitelist Management

```typescript
// Trusted Islamic content sources
const islamicWhitelist = [
  // Quran Reciters
  'Mishary Rashid Alafasy',
  'Abdul Rahman Al-Sudais',
  'Maher Al Muaiqly',

  // Islamic Channels
  'Bayyinah Institute',
  'Yaqeen Institute',
  'AlMaghrib Institute',

  // Nasheed Artists (with permission)
  'Maher Zain',
  'Sami Yusuf',
  'Native Deen'
];
```

## Testing Strategy

### Unit Tests

```typescript
// apps/processor/src/__tests__/copyright/policyEngine.test.ts
describe('Copyright Policy Engine', () => {
  test('should block high confidence matches', () => {
    const matches = [{ confidenceScore: 98, ... }];
    const policy = determinePolicy(matches);
    expect(policy.action).toBe('block');
  });

  test('should allow Islamic educational content', () => {
    const matches = [{
      contentType: 'quran_recitation',
      metadata: { purpose: 'educational', monetized: false }
    }];
    const policy = determinePolicy(matches);
    expect(policy.action).toBe('allow');
  });
});
```

### Integration Tests

```typescript
// apps/processor/src/__tests__/copyright/integration.test.ts
describe('Copyright Scan Integration', () => {
  test('should complete full scan workflow', async () => {
    const message = createTestMessage();
    await handleCopyrightScan(message);

    const result = await getScanResult(message.videoId);
    expect(result.status).toBe('completed');
  });

  test('should handle API failures gracefully', async () => {
    mockAudibleMagicFailure();
    const message = createTestMessage();
    await handleCopyrightScan(message);

    const result = await getScanResult(message.videoId);
    expect(result.status).toBe('manual_review');
  });
});
```

### E2E Tests

```typescript
// apps/web/e2e/copyright.spec.ts
describe('Copyright Detection E2E', () => {
  test('Creator can dispute copyright claim', async () => {
    // Upload video with known copyright content
    await uploadVideo('test-copyrighted.mp4');

    // Wait for scan to complete
    await waitForScanComplete();

    // Navigate to disputes
    await page.goto('/studio/disputes');

    // File dispute
    await page.click('[data-test="file-dispute"]');
    await page.fill('[name="reason"]', 'Fair use - educational');
    await page.click('[type="submit"]');

    // Verify dispute created
    expect(await page.textContent('.dispute-status')).toBe('Pending Review');
  });
});
```

### Load Testing

```yaml
# k6/copyright-load-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up
    { duration: '5m', target: 100 }, // Stay at 100 concurrent scans
    { duration: '2m', target: 0 },   // Ramp down
  ],
};

export default function () {
  const response = http.post('/api/copyright/scan', {
    videoId: 'test-video-id',
    fileUrl: 'https://example.com/video.mp4'
  });

  check(response, {
    'scan initiated': (r) => r.status === 200,
    'response time < 2s': (r) => r.timings.duration < 2000,
  });
}
```

## Risk Assessment

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| API Provider Downtime | HIGH | LOW | Fallback to ACRCloud, manual review queue |
| False Positives | MEDIUM | MEDIUM | Dispute system, manual review, whitelist |
| Performance Impact | MEDIUM | LOW | Async processing, caching, CDN |
| Cost Overrun | MEDIUM | MEDIUM | Tiered scanning, sampling, monitoring |

### Legal Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| DMCA Violations | CRITICAL | LOW | Immediate takedown, repeat infringer policy |
| False Claims | MEDIUM | MEDIUM | Robust dispute process, legal review |
| International Copyright | HIGH | MEDIUM | Geo-blocking, local compliance |

### Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Creator Frustration | HIGH | MEDIUM | Clear communication, fast disputes |
| Platform Reputation | HIGH | LOW | Transparent policies, fair enforcement |
| Revenue Loss | MEDIUM | LOW | Monetization options, revenue sharing |

## Success Metrics

### KPIs

1. **Scan Performance**
   - Average scan time: < 30 seconds
   - API success rate: > 99%
   - False positive rate: < 5%

2. **Policy Effectiveness**
   - Copyright strikes prevented: > 90%
   - Dispute resolution time: < 48 hours
   - Creator satisfaction: > 80%

3. **Cost Efficiency**
   - Cost per video: < $0.04
   - Manual review rate: < 10%
   - Cached result usage: > 20%

### Monitoring Dashboard

```typescript
// Metrics to track
const copyrightMetrics = {
  // Real-time
  activeScans: number,
  scanQueue: number,
  apiLatency: number,

  // Daily
  totalScans: number,
  matchesFound: number,
  disputesFiled: number,

  // Weekly
  falsePositiveRate: percentage,
  avgResolutionTime: hours,
  costPerScan: dollars,

  // Monthly
  totalCost: dollars,
  platformCompliance: percentage,
  creatorSatisfaction: score
};
```

## Conclusion

The Copyright Detection System is a critical component for platform protection and creator trust. With Audible Magic as the primary provider, queue-based asynchronous processing, and a comprehensive dispute system, Al Ummah Now can effectively manage copyright compliance while respecting Islamic content considerations.

**Next Steps:**
1. Finalize Audible Magic contract
2. Set up development API access
3. Begin Phase 1 implementation
4. Establish Islamic content guidelines
5. Train review team on Islamic fair use

**Timeline:** 8 weeks from approval
**Budget:** $5,000 setup + $500-2,000/month operational
**ROI:** Platform protection and legal compliance

---

**Document Status:** Ready for Review
**Review Required By:** Technical Lead, Legal Counsel, Product Owner
**Implementation Start:** Upon approval