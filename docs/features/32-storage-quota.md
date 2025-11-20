# Feature 32: Storage Quota Display Implementation Plan

**Document Version**: 1.0
**Date**: 2025-11-20
**Author**: System Architect
**Status**: Planning
**Related Documents**:
- YouTube Feature Comparison: `/home/meywd/AlUmmahNow/docs/YOUTUBE_FEATURE_COMPARISON.md`
- Large File Handling: `/home/meywd/AlUmmahNow/docs/features/09-large-file-handling.md`

---

## Executive Summary

This document provides a detailed implementation plan for the **Storage Quota Display** feature, enabling users to view their remaining upload quota, usage statistics, and tier-based limits with warnings when approaching limits.

**Current State**: No quota tracking or display - users can upload until they hit technical limits
**Target State**: Transparent quota display with real-time usage tracking, tier-based limits, and proactive warnings

**Priority**: HIGH (from YouTube Feature Comparison)
**Complexity**: Medium (2-3 weeks)
**Dependencies**: User tier system, analytics tracking

---

## Table of Contents

1. [Feature Requirements](#1-feature-requirements)
2. [Quota Calculation System](#2-quota-calculation-system)
3. [Usage Tracking Architecture](#3-usage-tracking-architecture)
4. [Tier-Based Limits](#4-tier-based-limits)
5. [Quota Display UI](#5-quota-display-ui)
6. [Warning System](#6-warning-system)
7. [Technical Implementation Details](#7-technical-implementation-details)
8. [Files to Create/Modify](#8-files-to-createmodify)
9. [Testing Strategy](#9-testing-strategy)
10. [Rollout Plan](#10-rollout-plan)
11. [Success Metrics](#11-success-metrics)

---

## 1. Feature Requirements

### 1.1 Functional Requirements

#### FR-1: Quota Calculation
- Calculate total storage used by user across all videos
- Track monthly upload quota usage
- Calculate remaining quota in real-time
- Support multiple quota dimensions (size, count, duration)

#### FR-2: Usage Statistics Display
- Show current month's usage
- Display total storage used
- Show number of videos uploaded this month
- Display percentage of quota used
- Historical usage trends (last 3 months)

#### FR-3: Tier-Based Limits
- Different quota limits per user tier (Free, Verified, Premium, Enterprise)
- Clear indication of current tier
- Upgrade prompts when approaching limits
- Tier comparison table

#### FR-4: Warning System
- Warning at 75% quota usage
- Critical warning at 90% quota usage
- Notification when quota exceeded
- Email alerts for quota warnings
- In-app notifications and banners

#### FR-5: Quota Display Locations
- **Upload Page**: Primary quota display before file selection
- **Dashboard**: Quota widget in user dashboard
- **Settings Page**: Detailed quota breakdown
- **Channel Page**: Channel-specific storage stats
- **Navbar**: Compact quota indicator (optional)

### 1.2 Non-Functional Requirements

#### NFR-1: Performance
- Quota calculation completes in < 200ms
- Real-time updates within 5 seconds of upload
- Minimal database/R2 queries (use caching)

#### NFR-2: Accuracy
- Quota calculations accurate to ± 1%
- Quota updates within 10 seconds of video deletion/upload
- Handle concurrent uploads correctly

#### NFR-3: Scalability
- Support 100,000+ users without performance degradation
- Efficient quota aggregation queries
- Cached quota data with smart invalidation

#### NFR-4: User Experience
- Clear, non-technical language
- Color-coded status (green/yellow/red)
- Helpful upgrade prompts
- Bilingual support (English/Arabic)

---

## 2. Quota Calculation System

### 2.1 Quota Types

```typescript
// packages/shared-types/src/quota.ts

export enum QuotaDimension {
  STORAGE_SIZE = 'storage_size',      // Total bytes uploaded
  VIDEO_COUNT = 'video_count',        // Number of videos
  UPLOAD_COUNT = 'upload_count',      // Uploads this month
  BANDWIDTH = 'bandwidth',            // Monthly bandwidth used
  PROCESSING_MINUTES = 'processing'   // Video minutes processed
}

export interface QuotaLimit {
  dimension: QuotaDimension;
  limit: number;                      // Maximum allowed
  period: 'monthly' | 'lifetime';     // Reset period
  unit: 'bytes' | 'count' | 'minutes';
}

export interface QuotaUsage {
  dimension: QuotaDimension;
  used: number;                       // Current usage
  limit: number;                      // Maximum allowed
  percentage: number;                 // used / limit * 100
  remaining: number;                  // limit - used
  resetDate?: string;                 // When quota resets (ISO 8601)
}

export interface UserQuota {
  userId: string;
  tier: UserTier;
  period: string;                     // e.g., "2025-11"
  usage: QuotaUsage[];
  lastUpdated: string;
  warnings: QuotaWarning[];
}

export interface QuotaWarning {
  dimension: QuotaDimension;
  threshold: number;                  // e.g., 75, 90
  triggeredAt: string;
  acknowledged: boolean;
  message: string;
}
```

### 2.2 Calculation Logic

```typescript
// apps/api-videos/src/services/quota-calculator.ts

export class QuotaCalculator {
  private readonly r2: R2Bucket;

  constructor(r2Bucket: R2Bucket) {
    this.r2 = r2Bucket;
  }

  /**
   * Calculate total storage used by user across all videos
   */
  async calculateStorageUsage(userId: string): Promise<number> {
    const videos = await this.getUserVideos(userId);

    return videos.reduce((total, video) => {
      return total + (video.fileSize || 0);
    }, 0);
  }

  /**
   * Calculate monthly upload quota usage
   */
  async calculateMonthlyUsage(
    userId: string,
    period: string // Format: "2025-11"
  ): Promise<QuotaUsage[]> {
    const tier = await this.getUserTier(userId);
    const limits = TIER_LIMITS[tier];

    // Get all videos uploaded this month
    const monthlyVideos = await this.getVideosForPeriod(userId, period);

    // Calculate each dimension
    const storageUsed = monthlyVideos.reduce(
      (sum, v) => sum + (v.fileSize || 0),
      0
    );

    const videoCount = monthlyVideos.length;

    const processingMinutes = monthlyVideos.reduce(
      (sum, v) => sum + ((v.duration || 0) / 60),
      0
    );

    return [
      {
        dimension: QuotaDimension.STORAGE_SIZE,
        used: storageUsed,
        limit: limits.monthlyQuota,
        percentage: (storageUsed / limits.monthlyQuota) * 100,
        remaining: limits.monthlyQuota - storageUsed,
        resetDate: this.getNextMonthReset()
      },
      {
        dimension: QuotaDimension.VIDEO_COUNT,
        used: videoCount,
        limit: limits.videoQuota,
        percentage: (videoCount / limits.videoQuota) * 100,
        remaining: limits.videoQuota - videoCount,
        resetDate: this.getNextMonthReset()
      },
      {
        dimension: QuotaDimension.PROCESSING_MINUTES,
        used: processingMinutes,
        limit: limits.maxDuration * limits.videoQuota / 60,
        percentage: (processingMinutes / (limits.maxDuration * limits.videoQuota / 60)) * 100,
        remaining: (limits.maxDuration * limits.videoQuota / 60) - processingMinutes,
        resetDate: this.getNextMonthReset()
      }
    ];
  }

  /**
   * Get next quota reset date (first day of next month)
   */
  private getNextMonthReset(): string {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  /**
   * Get videos for specific period
   */
  private async getVideosForPeriod(
    userId: string,
    period: string
  ): Promise<VideoObject[]> {
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const allVideos = await this.getUserVideos(userId);

    return allVideos.filter(video => {
      const uploadDate = new Date(video.dateCreated);
      return uploadDate >= startDate && uploadDate <= endDate;
    });
  }

  /**
   * Check if user can upload given file size
   */
  async canUpload(
    userId: string,
    fileSize: number
  ): Promise<{ allowed: boolean; reason?: string; quota?: QuotaUsage }> {
    const period = this.getCurrentPeriod();
    const usage = await this.calculateMonthlyUsage(userId, period);

    const storageQuota = usage.find(
      u => u.dimension === QuotaDimension.STORAGE_SIZE
    );

    if (!storageQuota) {
      return { allowed: false, reason: 'QUOTA_NOT_FOUND' };
    }

    if (storageQuota.used + fileSize > storageQuota.limit) {
      return {
        allowed: false,
        reason: 'MONTHLY_QUOTA_EXCEEDED',
        quota: storageQuota
      };
    }

    return { allowed: true, quota: storageQuota };
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
```

### 2.3 Caching Strategy

```typescript
// apps/api-videos/src/services/quota-cache.ts

export class QuotaCache {
  private readonly kv: KVNamespace;
  private readonly TTL = 300; // 5 minutes

  async getQuota(userId: string): Promise<UserQuota | null> {
    const key = `quota:${userId}:${this.getCurrentPeriod()}`;
    const cached = await this.kv.get(key, 'json');
    return cached as UserQuota | null;
  }

  async setQuota(userId: string, quota: UserQuota): Promise<void> {
    const key = `quota:${userId}:${this.getCurrentPeriod()}`;
    await this.kv.put(key, JSON.stringify(quota), {
      expirationTtl: this.TTL
    });
  }

  async invalidateQuota(userId: string): Promise<void> {
    const key = `quota:${userId}:${this.getCurrentPeriod()}`;
    await this.kv.delete(key);
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
```

---

## 3. Usage Tracking Architecture

### 3.1 Real-Time Tracking

```typescript
// apps/processor/src/handlers/quota-tracker.ts

export class QuotaTracker {
  /**
   * Update quota on video upload
   */
  async onVideoUploaded(event: VideoUploadedEvent): Promise<void> {
    const { userId, videoId, fileSize, duration } = event;

    // Update usage in R2
    await this.incrementUsage(userId, {
      storageSize: fileSize,
      videoCount: 1,
      processingMinutes: duration / 60
    });

    // Invalidate cache
    await this.cache.invalidateQuota(userId);

    // Check for warnings
    await this.checkQuotaWarnings(userId);

    // Send analytics event
    await this.queueAnalyticsEvent({
      type: 'QUOTA_UPDATED',
      userId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update quota on video deletion
   */
  async onVideoDeleted(event: VideoDeletedEvent): Promise<void> {
    const { userId, videoId, fileSize, duration } = event;

    // Decrement usage
    await this.decrementUsage(userId, {
      storageSize: fileSize,
      videoCount: 1,
      processingMinutes: duration / 60
    });

    // Invalidate cache
    await this.cache.invalidateQuota(userId);
  }

  /**
   * Increment usage counters
   */
  private async incrementUsage(
    userId: string,
    delta: {
      storageSize: number;
      videoCount: number;
      processingMinutes: number;
    }
  ): Promise<void> {
    const period = this.getCurrentPeriod();
    const key = `quota-usage:${userId}:${period}`;

    const current = await this.r2.get(key);
    const usage = current
      ? await current.json<QuotaUsageRecord>()
      : this.createEmptyUsage(userId, period);

    usage.storageSize += delta.storageSize;
    usage.videoCount += delta.videoCount;
    usage.processingMinutes += delta.processingMinutes;
    usage.lastUpdated = new Date().toISOString();

    await this.r2.put(key, JSON.stringify(usage));
  }

  /**
   * Check if user needs quota warnings
   */
  private async checkQuotaWarnings(userId: string): Promise<void> {
    const quota = await this.calculator.calculateMonthlyUsage(
      userId,
      this.getCurrentPeriod()
    );

    for (const usage of quota) {
      // 75% threshold
      if (usage.percentage >= 75 && usage.percentage < 90) {
        await this.sendQuotaWarning(userId, usage, 75);
      }

      // 90% threshold
      if (usage.percentage >= 90 && usage.percentage < 100) {
        await this.sendQuotaWarning(userId, usage, 90);
      }

      // Exceeded
      if (usage.percentage >= 100) {
        await this.sendQuotaExceeded(userId, usage);
      }
    }
  }
}
```

### 3.2 Historical Tracking

```typescript
// apps/api-videos/src/services/quota-history.ts

export interface QuotaHistoryEntry {
  userId: string;
  period: string;
  storageUsed: number;
  videoCount: number;
  processingMinutes: number;
  tier: UserTier;
  timestamp: string;
}

export class QuotaHistory {
  /**
   * Get quota history for user (last N months)
   */
  async getHistory(
    userId: string,
    months: number = 3
  ): Promise<QuotaHistoryEntry[]> {
    const periods = this.getLastNPeriods(months);
    const history: QuotaHistoryEntry[] = [];

    for (const period of periods) {
      const usage = await this.getUsageForPeriod(userId, period);
      if (usage) {
        history.push({
          userId,
          period,
          storageUsed: usage.storageSize,
          videoCount: usage.videoCount,
          processingMinutes: usage.processingMinutes,
          tier: await this.getUserTier(userId),
          timestamp: new Date().toISOString()
        });
      }
    }

    return history;
  }

  /**
   * Archive current month's usage (runs on month end)
   */
  async archiveCurrentMonth(userId: string): Promise<void> {
    const period = this.getCurrentPeriod();
    const usage = await this.getUsageForPeriod(userId, period);

    if (usage) {
      const archiveKey = `quota-archive:${userId}:${period}`;
      await this.r2.put(archiveKey, JSON.stringify(usage));
    }
  }

  private getLastNPeriods(n: number): string[] {
    const periods: string[] = [];
    const now = new Date();

    for (let i = 0; i < n; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      periods.push(period);
    }

    return periods;
  }
}
```

---

## 4. Tier-Based Limits

### 4.1 Tier Definitions

```typescript
// packages/shared-types/src/user-tiers.ts

export enum UserTier {
  FREE = 'free',
  VERIFIED = 'verified',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise'
}

export interface TierQuotaLimits {
  // Storage limits
  monthlyQuota: number;           // Bytes per month
  totalStorageLimit?: number;     // Lifetime storage limit

  // Upload limits
  maxFileSize: number;            // Max single file size
  videoQuota: number;             // Videos per month
  maxDuration: number;            // Max video duration (seconds)

  // Concurrent limits
  maxConcurrentUploads: number;

  // Features
  unlimitedStorage: boolean;      // No lifetime limit
  priorityProcessing: boolean;
  customQuota: boolean;           // Can request custom limits
}

export const TIER_QUOTA_LIMITS: Record<UserTier, TierQuotaLimits> = {
  [UserTier.FREE]: {
    monthlyQuota: 5 * 1024 ** 3,          // 5 GB/month
    totalStorageLimit: 50 * 1024 ** 3,    // 50 GB total
    maxFileSize: 500 * 1024 ** 2,         // 500 MB
    videoQuota: 10,                       // 10 videos/month
    maxDuration: 15 * 60,                 // 15 minutes
    maxConcurrentUploads: 1,
    unlimitedStorage: false,
    priorityProcessing: false,
    customQuota: false
  },

  [UserTier.VERIFIED]: {
    monthlyQuota: 50 * 1024 ** 3,         // 50 GB/month
    totalStorageLimit: 500 * 1024 ** 3,   // 500 GB total
    maxFileSize: 2 * 1024 ** 3,           // 2 GB
    videoQuota: 100,                      // 100 videos/month
    maxDuration: 60 * 60,                 // 1 hour
    maxConcurrentUploads: 3,
    unlimitedStorage: false,
    priorityProcessing: false,
    customQuota: false
  },

  [UserTier.PREMIUM]: {
    monthlyQuota: 500 * 1024 ** 3,        // 500 GB/month
    totalStorageLimit: undefined,         // Unlimited
    maxFileSize: 10 * 1024 ** 3,          // 10 GB
    videoQuota: 500,                      // 500 videos/month
    maxDuration: 4 * 60 * 60,             // 4 hours
    maxConcurrentUploads: 10,
    unlimitedStorage: true,
    priorityProcessing: true,
    customQuota: false
  },

  [UserTier.ENTERPRISE]: {
    monthlyQuota: 5 * 1024 ** 4,          // 5 TB/month
    totalStorageLimit: undefined,         // Unlimited
    maxFileSize: 50 * 1024 ** 3,          // 50 GB
    videoQuota: 5000,                     // 5000 videos/month
    maxDuration: 12 * 60 * 60,            // 12 hours
    maxConcurrentUploads: 50,
    unlimitedStorage: true,
    priorityProcessing: true,
    customQuota: true
  }
};
```

### 4.2 Tier Verification

```typescript
// apps/api-videos/src/services/tier-manager.ts

export class TierManager {
  /**
   * Get user's current tier
   */
  async getUserTier(userId: string): Promise<UserTier> {
    const profile = await this.getProfile(userId);

    // Check if user has active subscription
    if (profile.subscription?.active) {
      switch (profile.subscription.plan) {
        case 'enterprise':
          return UserTier.ENTERPRISE;
        case 'premium':
          return UserTier.PREMIUM;
        default:
          break;
      }
    }

    // Check verification status
    if (profile.emailVerified && profile.phoneVerified) {
      return UserTier.VERIFIED;
    }

    return UserTier.FREE;
  }

  /**
   * Get tier limits for user
   */
  async getTierLimits(userId: string): Promise<TierQuotaLimits> {
    const tier = await this.getUserTier(userId);
    return TIER_QUOTA_LIMITS[tier];
  }

  /**
   * Check if user can upgrade tier
   */
  async canUpgradeTier(
    userId: string,
    targetTier: UserTier
  ): Promise<{ allowed: boolean; reason?: string }> {
    const currentTier = await this.getUserTier(userId);

    // Can't downgrade
    if (this.getTierRank(targetTier) <= this.getTierRank(currentTier)) {
      return {
        allowed: false,
        reason: 'Cannot downgrade or already at this tier'
      };
    }

    // Check prerequisites
    if (targetTier === UserTier.VERIFIED) {
      const profile = await this.getProfile(userId);
      if (!profile.emailVerified) {
        return { allowed: false, reason: 'Email verification required' };
      }
      if (!profile.phoneVerified) {
        return { allowed: false, reason: 'Phone verification required' };
      }
    }

    return { allowed: true };
  }

  private getTierRank(tier: UserTier): number {
    const ranks = {
      [UserTier.FREE]: 1,
      [UserTier.VERIFIED]: 2,
      [UserTier.PREMIUM]: 3,
      [UserTier.ENTERPRISE]: 4
    };
    return ranks[tier];
  }
}
```

---

## 5. Quota Display UI

### 5.1 Primary Quota Widget (Upload Page)

```typescript
// apps/web/src/components/quota/QuotaDisplay.tsx

import { useLanguage } from '@/hooks/useLanguage';
import { formatBytes, formatNumber } from '@/lib/i18n-helpers';

interface QuotaDisplayProps {
  userId: string;
  variant?: 'full' | 'compact' | 'minimal';
}

export function QuotaDisplay({ userId, variant = 'full' }: QuotaDisplayProps) {
  const { t, isRTL } = useLanguage();
  const { data: quota, isLoading } = useQuota(userId);

  if (isLoading) {
    return <QuotaSkeleton />;
  }

  const storageUsage = quota?.usage.find(
    u => u.dimension === 'storage_size'
  );

  if (!storageUsage) {
    return null;
  }

  const statusColor = getStatusColor(storageUsage.percentage);
  const showWarning = storageUsage.percentage >= 75;

  return (
    <div
      className={`quota-display ${variant}`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="quota-header">
        <h3>{t('quota.title')}</h3>
        <TierBadge tier={quota.tier} />
      </div>

      {/* Main usage display */}
      <div className="quota-usage">
        <ProgressBar
          percentage={storageUsage.percentage}
          color={statusColor}
        />

        <div className="quota-stats">
          <div className="stat">
            <span className="label">{t('quota.used')}</span>
            <span className="value">
              {formatBytes(storageUsage.used, locale)}
            </span>
          </div>

          <div className="stat">
            <span className="label">{t('quota.remaining')}</span>
            <span className="value">
              {formatBytes(storageUsage.remaining, locale)}
            </span>
          </div>

          <div className="stat">
            <span className="label">{t('quota.limit')}</span>
            <span className="value">
              {formatBytes(storageUsage.limit, locale)}
            </span>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      {showWarning && (
        <QuotaWarningBanner
          percentage={storageUsage.percentage}
          resetDate={storageUsage.resetDate}
          tier={quota.tier}
        />
      )}

      {/* Reset info */}
      <div className="quota-reset">
        {t('quota.resets_on', {
          date: formatDate(storageUsage.resetDate, locale)
        })}
      </div>

      {/* Upgrade CTA (if not max tier) */}
      {quota.tier !== 'enterprise' && (
        <UpgradePrompt
          currentTier={quota.tier}
          nextTier={getNextTier(quota.tier)}
        />
      )}
    </div>
  );
}

function getStatusColor(percentage: number): string {
  if (percentage >= 90) return 'red';
  if (percentage >= 75) return 'yellow';
  return 'green';
}
```

### 5.2 Compact Quota Indicator (Navbar)

```typescript
// apps/web/src/components/quota/QuotaIndicator.tsx

export function QuotaIndicator({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const { data: quota } = useQuota(userId);

  if (!quota) return null;

  const storageUsage = quota.usage.find(u => u.dimension === 'storage_size');
  if (!storageUsage) return null;

  const percentage = storageUsage.percentage;
  const statusIcon = getStatusIcon(percentage);
  const statusColor = getStatusColor(percentage);

  return (
    <Tooltip content={t('quota.view_details')}>
      <Link href="/settings/quota">
        <div className={`quota-indicator ${statusColor}`}>
          <Icon name={statusIcon} size={16} />
          <span className="percentage">{Math.round(percentage)}%</span>
        </div>
      </Link>
    </Tooltip>
  );
}

function getStatusIcon(percentage: number): string {
  if (percentage >= 90) return 'alert-circle';
  if (percentage >= 75) return 'alert-triangle';
  return 'check-circle';
}
```

### 5.3 Detailed Quota Page

```typescript
// apps/web/src/app/[locale]/settings/quota/page.tsx

export default function QuotaPage() {
  const { t, locale } = useLanguage();
  const { userId } = useAuth();
  const { data: quota } = useQuota(userId);
  const { data: history } = useQuotaHistory(userId, 3);

  return (
    <div className="quota-page">
      <h1>{t('quota.page_title')}</h1>

      {/* Current tier info */}
      <TierOverview tier={quota.tier} />

      {/* Usage breakdown */}
      <section className="usage-breakdown">
        <h2>{t('quota.current_usage')}</h2>

        {quota.usage.map(usage => (
          <QuotaDimensionCard
            key={usage.dimension}
            dimension={usage.dimension}
            usage={usage}
          />
        ))}
      </section>

      {/* Historical chart */}
      <section className="usage-history">
        <h2>{t('quota.usage_history')}</h2>
        <QuotaHistoryChart data={history} />
      </section>

      {/* Tier comparison table */}
      <section className="tier-comparison">
        <h2>{t('quota.tier_comparison')}</h2>
        <TierComparisonTable currentTier={quota.tier} />
      </section>

      {/* Manage storage */}
      <section className="storage-management">
        <h2>{t('quota.manage_storage')}</h2>
        <StorageBreakdown userId={userId} />
        <DeleteVideosButton />
      </section>
    </div>
  );
}
```

### 5.4 RTL (Arabic) Version

```typescript
// apps/web/src/components/quota/rtl/QuotaDisplay.tsx

import { useLanguage } from '@/hooks/useLanguage';

export function QuotaDisplayRTL({ userId, variant }: QuotaDisplayProps) {
  const { t } = useLanguage();
  const { data: quota } = useQuota(userId);

  return (
    <div className="quota-display rtl" dir="rtl">
      {/* Mirror layout for RTL */}
      <div className="quota-header">
        <TierBadge tier={quota.tier} />
        <h3>{t('quota.title')}</h3>
      </div>

      {/* Progress bar direction reversed */}
      <ProgressBarRTL
        percentage={storageUsage.percentage}
        color={statusColor}
      />

      {/* Stats reversed */}
      <div className="quota-stats rtl">
        <div className="stat">
          <span className="value">
            {formatBytes(storageUsage.limit, 'ar')}
          </span>
          <span className="label">{t('quota.limit')}</span>
        </div>

        <div className="stat">
          <span className="value">
            {formatBytes(storageUsage.remaining, 'ar')}
          </span>
          <span className="label">{t('quota.remaining')}</span>
        </div>

        <div className="stat">
          <span className="value">
            {formatBytes(storageUsage.used, 'ar')}
          </span>
          <span className="label">{t('quota.used')}</span>
        </div>
      </div>

      {/* Rest of component with RTL support */}
    </div>
  );
}
```

---

## 6. Warning System

### 6.1 Warning Triggers

```typescript
// apps/processor/src/services/quota-warnings.ts

export class QuotaWarningService {
  private readonly THRESHOLDS = {
    WARNING: 75,
    CRITICAL: 90,
    EXCEEDED: 100
  };

  async checkAndSendWarnings(userId: string): Promise<void> {
    const quota = await this.calculator.calculateMonthlyUsage(
      userId,
      this.getCurrentPeriod()
    );

    for (const usage of quota) {
      await this.checkThresholds(userId, usage);
    }
  }

  private async checkThresholds(
    userId: string,
    usage: QuotaUsage
  ): Promise<void> {
    const percentage = usage.percentage;

    // 75% warning (first time only)
    if (percentage >= this.THRESHOLDS.WARNING &&
        percentage < this.THRESHOLDS.CRITICAL &&
        !await this.hasWarning(userId, usage.dimension, 75)) {

      await this.sendWarning(userId, usage, {
        level: 'warning',
        threshold: 75,
        title: 'Approaching quota limit',
        message: `You've used ${Math.round(percentage)}% of your ${usage.dimension} quota.`,
        action: 'Consider upgrading your plan for more storage.'
      });
    }

    // 90% critical warning
    if (percentage >= this.THRESHOLDS.CRITICAL &&
        percentage < this.THRESHOLDS.EXCEEDED &&
        !await this.hasWarning(userId, usage.dimension, 90)) {

      await this.sendWarning(userId, usage, {
        level: 'critical',
        threshold: 90,
        title: 'Quota almost full',
        message: `You've used ${Math.round(percentage)}% of your ${usage.dimension} quota.`,
        action: 'Upgrade now or delete old videos to free space.'
      });
    }

    // Quota exceeded
    if (percentage >= this.THRESHOLDS.EXCEEDED &&
        !await this.hasWarning(userId, usage.dimension, 100)) {

      await this.sendExceededNotification(userId, usage, {
        level: 'error',
        threshold: 100,
        title: 'Quota exceeded',
        message: `Your ${usage.dimension} quota is full. New uploads are blocked.`,
        action: 'Upgrade your plan to continue uploading.'
      });
    }
  }

  private async sendWarning(
    userId: string,
    usage: QuotaUsage,
    warning: WarningConfig
  ): Promise<void> {
    // Save warning to database
    await this.saveWarning(userId, usage.dimension, warning);

    // Send in-app notification
    await this.notificationService.send({
      userId,
      type: 'QUOTA_WARNING',
      level: warning.level,
      title: warning.title,
      message: warning.message,
      action: {
        label: 'View Quota',
        url: '/settings/quota'
      }
    });

    // Send email if critical or exceeded
    if (warning.level === 'critical' || warning.level === 'error') {
      await this.emailService.send({
        to: await this.getUserEmail(userId),
        template: 'quota-warning',
        data: {
          percentage: usage.percentage,
          used: usage.used,
          limit: usage.limit,
          resetDate: usage.resetDate,
          warningLevel: warning.level
        }
      });
    }

    // Send WebSocket notification (real-time)
    await this.websocketService.broadcast({
      userId,
      event: 'quota:warning',
      data: {
        dimension: usage.dimension,
        percentage: usage.percentage,
        warning
      }
    });
  }

  private async hasWarning(
    userId: string,
    dimension: QuotaDimension,
    threshold: number
  ): Promise<boolean> {
    const key = `quota-warning:${userId}:${dimension}:${threshold}:${this.getCurrentPeriod()}`;
    const existing = await this.kv.get(key);
    return existing !== null;
  }

  private async saveWarning(
    userId: string,
    dimension: QuotaDimension,
    warning: WarningConfig
  ): Promise<void> {
    const key = `quota-warning:${userId}:${dimension}:${warning.threshold}:${this.getCurrentPeriod()}`;
    await this.kv.put(key, JSON.stringify(warning), {
      expirationTtl: 30 * 24 * 60 * 60 // 30 days
    });
  }
}
```

### 6.2 Warning UI Components

```typescript
// apps/web/src/components/quota/QuotaWarningBanner.tsx

export function QuotaWarningBanner({
  percentage,
  resetDate,
  tier
}: QuotaWarningBannerProps) {
  const { t } = useLanguage();
  const level = getWarningLevel(percentage);

  return (
    <div className={`quota-warning-banner ${level}`}>
      <Icon name={getIcon(level)} />

      <div className="warning-content">
        <h4>{t(`quota.warning.${level}.title`)}</h4>
        <p>
          {t(`quota.warning.${level}.message`, {
            percentage: Math.round(percentage),
            resetDate: formatDate(resetDate)
          })}
        </p>
      </div>

      {level !== 'exceeded' && (
        <Button
          variant="primary"
          onClick={() => navigate('/settings/upgrade')}
        >
          {t('quota.upgrade_now')}
        </Button>
      )}

      {level === 'exceeded' && (
        <div className="warning-actions">
          <Button onClick={() => navigate('/videos')}>
            {t('quota.manage_videos')}
          </Button>
          <Button variant="primary" onClick={() => navigate('/settings/upgrade')}>
            {t('quota.upgrade_plan')}
          </Button>
        </div>
      )}
    </div>
  );
}

function getWarningLevel(percentage: number): 'warning' | 'critical' | 'exceeded' {
  if (percentage >= 100) return 'exceeded';
  if (percentage >= 90) return 'critical';
  return 'warning';
}

function getIcon(level: string): string {
  const icons = {
    warning: 'alert-triangle',
    critical: 'alert-octagon',
    exceeded: 'x-circle'
  };
  return icons[level];
}
```

---

## 7. Technical Implementation Details

### 7.1 API Endpoints

```typescript
// apps/api-videos/src/endpoints/quota/quotaFetch.ts

import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';

export class QuotaFetch extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Quota'],
    summary: 'Get user quota and usage',
    request: {
      params: z.object({
        userId: z.string().describe('User ID')
      }),
      query: z.object({
        period: z.string().optional().describe('Period (YYYY-MM, defaults to current)')
      })
    },
    responses: {
      200: {
        description: 'Quota details',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              result: z.object({
                userId: z.string(),
                tier: z.enum(['free', 'verified', 'premium', 'enterprise']),
                period: z.string(),
                usage: z.array(z.object({
                  dimension: z.string(),
                  used: z.number(),
                  limit: z.number(),
                  percentage: z.number(),
                  remaining: z.number(),
                  resetDate: z.string().optional()
                })),
                warnings: z.array(z.object({
                  dimension: z.string(),
                  threshold: z.number(),
                  message: z.string(),
                  triggeredAt: z.string()
                })),
                lastUpdated: z.string()
              })
            })
          }
        }
      }
    }
  }, 'required');

  async handle(c) {
    const { userId: requestedUserId } = await this.getValidatedData<typeof this.schema>();
    const auth = c.get('auth');
    const period = c.req.query('period') || this.getCurrentPeriod();

    // Users can only view their own quota (unless admin)
    if (auth.userId !== requestedUserId && auth.role !== 'admin') {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Check cache first
    const cache = new QuotaCache(c.env.RATE_LIMIT_KV);
    let quota = await cache.getQuota(requestedUserId);

    if (!quota) {
      // Calculate quota
      const calculator = new QuotaCalculator(c.env.videos);
      const usage = await calculator.calculateMonthlyUsage(requestedUserId, period);
      const tier = await new TierManager().getUserTier(requestedUserId);
      const warnings = await this.getWarnings(requestedUserId, period);

      quota = {
        userId: requestedUserId,
        tier,
        period,
        usage,
        warnings,
        lastUpdated: new Date().toISOString()
      };

      // Cache for 5 minutes
      await cache.setQuota(requestedUserId, quota);
    }

    return c.json({ success: true, result: quota });
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private async getWarnings(userId: string, period: string): Promise<QuotaWarning[]> {
    // Fetch warnings from KV
    const warningKeys = await this.kv.list({ prefix: `quota-warning:${userId}:` });
    const warnings: QuotaWarning[] = [];

    for (const key of warningKeys.keys) {
      const warning = await this.kv.get(key.name, 'json');
      if (warning) {
        warnings.push(warning as QuotaWarning);
      }
    }

    return warnings;
  }
}
```

```typescript
// apps/api-videos/src/endpoints/quota/quotaHistory.ts

export class QuotaHistoryFetch extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ['Quota'],
    summary: 'Get quota usage history',
    request: {
      params: z.object({
        userId: z.string()
      }),
      query: z.object({
        months: z.number().min(1).max(12).default(3)
      })
    },
    responses: {
      200: {
        description: 'Historical quota data',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              result: z.array(z.object({
                period: z.string(),
                storageUsed: z.number(),
                videoCount: z.number(),
                tier: z.string(),
                timestamp: z.string()
              }))
            })
          }
        }
      }
    }
  }, 'required');

  async handle(c) {
    const { userId } = await this.getValidatedData<typeof this.schema>();
    const months = Number(c.req.query('months')) || 3;

    const history = new QuotaHistory(c.env.videos);
    const data = await history.getHistory(userId, months);

    return c.json({ success: true, result: data });
  }
}
```

### 7.2 Client Hooks

```typescript
// apps/web/src/hooks/useQuota.ts

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export function useQuota(userId: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['quota', userId],
    queryFn: async () => {
      const response = await apiClient.get(`/api/quota/${userId}`);
      return response.data.result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: true
  });
}

export function useQuotaHistory(userId: string, months: number = 3) {
  return useQuery({
    queryKey: ['quota-history', userId, months],
    queryFn: async () => {
      const response = await apiClient.get(`/api/quota/${userId}/history`, {
        params: { months }
      });
      return response.data.result;
    },
    staleTime: 10 * 60 * 1000 // 10 minutes
  });
}

export function useInvalidateQuota(userId: string) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ['quota', userId] });
  };
}
```

### 7.3 Real-Time Updates

```typescript
// apps/web/src/hooks/useQuotaRealtime.ts

import { useEffect } from 'react';
import { useWebSocket } from '@/lib/websocket/WebSocketProvider';
import { useInvalidateQuota } from './useQuota';

export function useQuotaRealtime(userId: string) {
  const ws = useWebSocket();
  const invalidateQuota = useInvalidateQuota(userId);

  useEffect(() => {
    if (!ws) return;

    // Subscribe to quota updates
    ws.subscribe(`user:${userId}`, (message) => {
      if (message.event === 'quota:updated' ||
          message.event === 'quota:warning') {
        // Invalidate and refetch quota
        invalidateQuota();
      }
    });

    return () => {
      ws.unsubscribe(`user:${userId}`);
    };
  }, [ws, userId, invalidateQuota]);
}
```

---

## 8. Files to Create/Modify

### 8.1 New Files to Create

```bash
# Shared Types
packages/shared-types/src/
├── quota.ts                    # Quota types and interfaces
└── user-tiers.ts              # Tier definitions and limits

# API Services
apps/api-videos/src/services/
├── quota-calculator.ts        # Quota calculation logic
├── quota-cache.ts             # KV-based caching
├── tier-manager.ts            # User tier management
└── quota-history.ts           # Historical tracking

# API Endpoints
apps/api-videos/src/endpoints/quota/
├── quotaFetch.ts              # GET /api/quota/:userId
├── quotaHistory.ts            # GET /api/quota/:userId/history
└── quotaCheck.ts              # POST /api/quota/check (pre-upload validation)

# Processor
apps/processor/src/handlers/
├── quota-tracker.ts           # Track upload/delete events
└── quota-warnings.ts          # Warning system

apps/processor/src/services/
└── quota-warning-service.ts   # Send warnings/notifications

# Web Components
apps/web/src/components/quota/
├── QuotaDisplay.tsx           # Main quota widget
├── QuotaIndicator.tsx         # Navbar indicator
├── QuotaWarningBanner.tsx     # Warning banner
├── TierBadge.tsx              # Tier display badge
├── TierComparisonTable.tsx    # Tier comparison
├── UpgradePrompt.tsx          # Upgrade CTA
├── QuotaDimensionCard.tsx     # Individual quota metric
├── QuotaHistoryChart.tsx      # Historical chart
└── rtl/
    ├── QuotaDisplay.tsx       # RTL version
    └── QuotaWarningBanner.tsx # RTL version

# Web Pages
apps/web/src/app/[locale]/settings/quota/
└── page.tsx                   # Detailed quota page

# Hooks
apps/web/src/hooks/
├── useQuota.ts                # Quota data hook
├── useQuotaHistory.ts         # History hook
└── useQuotaRealtime.ts        # Real-time updates

# i18n Translations
apps/web/src/lib/i18n/translations/
├── en.ts                      # English translations
└── ar.ts                      # Arabic translations

# Utilities
apps/web/src/lib/
├── formatters/quota.ts        # Quota formatting utilities
└── validators/upload.ts       # Pre-upload validation
```

### 8.2 Files to Modify

```bash
# Add quota fields to video model
packages/shared-types/src/
└── video.ts                   # Add fileSize tracking

# Add tier/quota fields to profile
packages/shared-types/src/
└── user.ts                    # Add tier, subscription fields

# Update upload endpoints with quota checks
apps/api-videos/src/endpoints/video/
├── uploadInitiate.ts          # Add quota validation
├── uploadComplete.ts          # Update usage on complete
└── videoDelete.ts             # Decrement usage on delete

# Update processor to track quota events
apps/processor/src/
├── index.ts                   # Add quota event handlers
└── messageProcessor.ts        # Process quota messages

# Update upload component with quota display
apps/web/src/components/videoUpload/
└── index.tsx                  # Add quota widget

# Update navbar with quota indicator
apps/web/src/components/layout/
└── Navbar.tsx                 # Add quota indicator

# Add quota namespace to KV
apps/api-videos/
└── wrangler.jsonc             # Add QUOTA_KV namespace

# Add quota-related i18n keys
apps/web/src/lib/i18n/translations/
├── en.ts                      # Add quota.* keys
└── ar.ts                      # Add quota.* keys
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// apps/api-videos/src/services/__tests__/quota-calculator.test.ts

describe('QuotaCalculator', () => {
  let calculator: QuotaCalculator;
  let mockR2: R2Bucket;

  beforeEach(() => {
    mockR2 = createMockR2Bucket();
    calculator = new QuotaCalculator(mockR2);
  });

  describe('calculateStorageUsage', () => {
    it('should calculate total storage for user', async () => {
      mockUserVideos(mockR2, 'user1', [
        { fileSize: 100 * MB },
        { fileSize: 200 * MB },
        { fileSize: 50 * MB }
      ]);

      const usage = await calculator.calculateStorageUsage('user1');
      expect(usage).toBe(350 * MB);
    });

    it('should return 0 for user with no videos', async () => {
      mockUserVideos(mockR2, 'user1', []);
      const usage = await calculator.calculateStorageUsage('user1');
      expect(usage).toBe(0);
    });
  });

  describe('calculateMonthlyUsage', () => {
    it('should calculate usage for current month', async () => {
      mockUserVideos(mockR2, 'user1', [
        { fileSize: 1 * GB, dateCreated: '2025-11-05' },
        { fileSize: 500 * MB, dateCreated: '2025-11-15' },
        { fileSize: 2 * GB, dateCreated: '2025-10-20' } // Previous month
      ]);

      const usage = await calculator.calculateMonthlyUsage('user1', '2025-11');
      const storageQuota = usage.find(u => u.dimension === 'storage_size');

      expect(storageQuota.used).toBe(1.5 * GB);
    });

    it('should calculate percentage correctly', async () => {
      const tier = UserTier.FREE;
      const limit = TIER_QUOTA_LIMITS[tier].monthlyQuota; // 5 GB

      mockUserVideos(mockR2, 'user1', [
        { fileSize: 2.5 * GB, dateCreated: '2025-11-01' }
      ]);

      const usage = await calculator.calculateMonthlyUsage('user1', '2025-11');
      const storageQuota = usage.find(u => u.dimension === 'storage_size');

      expect(storageQuota.percentage).toBeCloseTo(50, 1); // 50%
    });
  });

  describe('canUpload', () => {
    it('should allow upload within quota', async () => {
      mockUserVideos(mockR2, 'user1', [
        { fileSize: 1 * GB }
      ]);

      const result = await calculator.canUpload('user1', 500 * MB);
      expect(result.allowed).toBe(true);
    });

    it('should reject upload exceeding quota', async () => {
      mockUserVideos(mockR2, 'user1', [
        { fileSize: 4.5 * GB }
      ]);

      const result = await calculator.canUpload('user1', 1 * GB);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('MONTHLY_QUOTA_EXCEEDED');
    });
  });
});
```

### 9.2 Integration Tests

```typescript
// apps/api-videos/src/endpoints/quota/__tests__/quotaFetch.test.ts

describe('GET /api/quota/:userId', () => {
  it('should return quota for authenticated user', async () => {
    const userId = 'test-user-1';
    const token = await generateTestToken(userId);

    const response = await request(app)
      .get(`/api/quota/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.result).toMatchObject({
      userId,
      tier: expect.any(String),
      period: expect.any(String),
      usage: expect.any(Array),
      warnings: expect.any(Array)
    });
  });

  it('should reject unauthorized access', async () => {
    const response = await request(app)
      .get('/api/quota/user1')
      .expect(401);

    expect(response.body.success).toBe(false);
  });

  it('should prevent users from viewing others quota', async () => {
    const token = await generateTestToken('user1');

    const response = await request(app)
      .get('/api/quota/user2')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.success).toBe(false);
  });
});
```

### 9.3 E2E Tests

```typescript
// apps/web/e2e/quota-display.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Quota Display', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'free-tier-user');
  });

  test('should show quota widget on upload page', async ({ page }) => {
    await page.goto('/upload');

    const quotaWidget = page.locator('.quota-display');
    await expect(quotaWidget).toBeVisible();

    await expect(quotaWidget.locator('h3')).toContainText('Storage Quota');
    await expect(quotaWidget.locator('.tier-badge')).toContainText('Free');
  });

  test('should display warning when approaching limit', async ({ page }) => {
    // Mock user with 80% quota used
    await mockQuotaUsage(page, {
      used: 4 * GB,
      limit: 5 * GB,
      percentage: 80
    });

    await page.goto('/upload');

    const warning = page.locator('.quota-warning-banner');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('80%');
  });

  test('should show upgrade prompt when quota exceeded', async ({ page }) => {
    await mockQuotaUsage(page, {
      used: 5.2 * GB,
      limit: 5 * GB,
      percentage: 104
    });

    await page.goto('/upload');

    const banner = page.locator('.quota-warning-banner.exceeded');
    await expect(banner).toBeVisible();

    const upgradeButton = banner.locator('button', { hasText: 'Upgrade Plan' });
    await expect(upgradeButton).toBeVisible();
  });

  test('should update quota in real-time after upload', async ({ page }) => {
    await page.goto('/upload');

    const initialUsed = await page.locator('.quota-stats .used .value').textContent();

    // Upload a file
    await uploadTestVideo(page, 100 * MB);

    // Wait for quota to update
    await page.waitForTimeout(2000);

    const newUsed = await page.locator('.quota-stats .used .value').textContent();
    expect(newUsed).not.toBe(initialUsed);
  });

  test('should navigate to detailed quota page', async ({ page }) => {
    await page.goto('/upload');

    await page.click('a[href="/settings/quota"]');
    await expect(page).toHaveURL('/settings/quota');

    await expect(page.locator('h1')).toContainText('Storage Quota');
    await expect(page.locator('.usage-breakdown')).toBeVisible();
    await expect(page.locator('.usage-history')).toBeVisible();
  });
});

test.describe('Quota RTL (Arabic)', () => {
  test('should display quota in Arabic', async ({ page }) => {
    await page.goto('/ar/upload');
    await loginAs(page, 'free-tier-user');

    const quotaWidget = page.locator('.quota-display.rtl');
    await expect(quotaWidget).toBeVisible();
    await expect(quotaWidget).toHaveAttribute('dir', 'rtl');

    // Check Arabic text
    await expect(quotaWidget).toContainText('حصة التخزين');
  });
});
```

### 9.4 Performance Tests

```typescript
// load-tests/quota-calculation.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 }
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% under 500ms
  }
};

export default function() {
  const userId = `user-${Math.floor(Math.random() * 1000)}`;

  const response = http.get(
    `https://api.alummahnow.net/api/quota/${userId}`,
    {
      headers: {
        'Authorization': `Bearer ${__ENV.TEST_TOKEN}`
      }
    }
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'has usage data': (r) => JSON.parse(r.body).result?.usage?.length > 0
  });

  sleep(1);
}
```

---

## 10. Rollout Plan

### 10.1 Phase 1: Backend Foundation (Week 1)

**Goals**:
- Implement quota calculation system
- Set up storage tracking
- Create API endpoints

**Tasks**:
- [ ] Create quota types (`packages/shared-types/src/quota.ts`)
- [ ] Implement `QuotaCalculator` service
- [ ] Implement `QuotaCache` service
- [ ] Implement `TierManager` service
- [ ] Create `/api/quota/:userId` endpoint
- [ ] Create `/api/quota/:userId/history` endpoint
- [ ] Add unit tests for calculation logic

**Validation**:
- Run unit tests (100% pass rate)
- Test API endpoints with Postman
- Verify cache performance

### 10.2 Phase 2: Usage Tracking (Week 2)

**Goals**:
- Track uploads and deletions
- Implement real-time updates
- Set up warning system

**Tasks**:
- [ ] Implement `QuotaTracker` in processor
- [ ] Add quota update on video upload
- [ ] Add quota update on video deletion
- [ ] Implement warning triggers (75%, 90%, 100%)
- [ ] Set up email notifications
- [ ] Set up WebSocket notifications
- [ ] Add integration tests

**Validation**:
- Upload test video, verify quota updates
- Delete video, verify quota decrements
- Trigger warnings at different thresholds

### 10.3 Phase 3: UI Implementation (Week 3)

**Goals**:
- Build quota display components
- Create detailed quota page
- Add warning banners

**Tasks**:
- [ ] Create `QuotaDisplay` component (LTR)
- [ ] Create `QuotaDisplay` RTL version
- [ ] Create `QuotaIndicator` for navbar
- [ ] Create `QuotaWarningBanner` component
- [ ] Create tier comparison table
- [ ] Build `/settings/quota` page
- [ ] Add i18n translations (EN/AR)
- [ ] Implement real-time updates hook

**Validation**:
- Visual QA on all components
- Test responsive design
- Test RTL layout
- Test dark/light themes

### 10.4 Phase 4: Integration & Testing (Week 4)

**Goals**:
- Integrate all components
- Comprehensive testing
- Performance optimization

**Tasks**:
- [ ] Integrate quota display in upload page
- [ ] Add quota indicator to navbar
- [ ] Implement quota checks in upload flow
- [ ] Run E2E tests
- [ ] Run performance tests
- [ ] Optimize cache strategy
- [ ] Security audit
- [ ] Accessibility audit

**Validation**:
- All E2E tests pass
- Performance targets met (< 200ms calculation)
- WCAG 2.1 AA compliance
- Zero security vulnerabilities

### 10.5 Phase 5: Gradual Rollout (Week 5-6)

**Deployment Strategy**:
1. **Week 5**: Staging deployment (100% of staging users)
2. **Week 6 Day 1-2**: Production 10% rollout
3. **Week 6 Day 3-4**: Production 25% rollout
4. **Week 6 Day 5-6**: Production 50% rollout
5. **Week 6 Day 7**: Production 100% rollout

**Monitoring**:
- Track quota calculation performance
- Monitor cache hit rates
- Track warning notification delivery
- Monitor user feedback
- Track upgrade conversion rates

**Rollback Criteria**:
- Performance degradation > 20%
- Error rate > 2%
- Cache hit rate < 80%
- User complaints > 5%

---

## 11. Success Metrics

### 11.1 Technical Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Quota Calculation Time | < 200ms | API response time monitoring |
| Cache Hit Rate | > 85% | KV metrics |
| Real-time Update Latency | < 5s | WebSocket delivery time |
| API Error Rate | < 0.5% | Error logs |
| Database Query Efficiency | < 50ms | R2 operation metrics |

### 11.2 User Experience Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Quota Page Load Time | < 2s | Web vitals |
| Warning Notification Delivery | > 95% | Notification logs |
| User Understanding | > 80% | User survey |
| Mobile Responsiveness | 100% | Cross-device testing |
| Accessibility Score | AAA | Lighthouse audit |

### 11.3 Business Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Tier Upgrade Conversion | > 5% | Conversion tracking |
| Quota-Related Support Tickets | < 3% | Support ticket analysis |
| User Retention (quota users) | > 90% | Cohort analysis |
| Feature Adoption | > 60% | Analytics (quota page views) |
| Quota Abuse Rate | < 1% | Anomaly detection |

### 11.4 Monitoring Dashboard

```typescript
// apps/web/src/app/[locale]/admin/quota-metrics/page.tsx

export default function QuotaMetricsDashboard() {
  return (
    <div className="quota-metrics-dashboard">
      {/* Technical Metrics */}
      <section>
        <h2>Technical Performance</h2>
        <MetricCard
          title="Avg Calculation Time"
          value="142ms"
          target="< 200ms"
          status="healthy"
        />
        <MetricCard
          title="Cache Hit Rate"
          value="88%"
          target="> 85%"
          status="healthy"
        />
      </section>

      {/* User Metrics */}
      <section>
        <h2>User Engagement</h2>
        <MetricCard
          title="Quota Page Views"
          value="12,453"
          trend="+15%"
        />
        <MetricCard
          title="Warning Notifications Sent"
          value="1,234"
          trend="+8%"
        />
      </section>

      {/* Business Metrics */}
      <section>
        <h2>Business Impact</h2>
        <MetricCard
          title="Tier Upgrades (from quota warnings)"
          value="123"
          trend="+22%"
          conversion="6.2%"
        />
      </section>

      {/* Tier Distribution */}
      <TierDistributionChart />

      {/* Usage Trends */}
      <UsageTrendsChart />
    </div>
  );
}
```

---

## Appendix A: i18n Translations

### English Translations

```typescript
// apps/web/src/lib/i18n/translations/en.ts

export const en = {
  quota: {
    // Headings
    title: 'Storage Quota',
    page_title: 'Storage Quota & Usage',

    // Stats
    used: 'Used',
    remaining: 'Remaining',
    limit: 'Limit',
    percentage: 'Usage',

    // Dimensions
    storage_size: 'Storage',
    video_count: 'Videos',
    upload_count: 'Uploads',
    processing: 'Processing Time',

    // Time
    resets_on: 'Resets on {date}',
    last_updated: 'Last updated {time}',

    // Actions
    upgrade_now: 'Upgrade Now',
    view_details: 'View Quota Details',
    manage_videos: 'Manage Videos',
    upgrade_plan: 'Upgrade Plan',

    // Warnings
    warning: {
      warning: {
        title: 'Approaching Quota Limit',
        message: "You've used {percentage}% of your storage quota. Consider upgrading for more space."
      },
      critical: {
        title: 'Quota Almost Full',
        message: "You've used {percentage}% of your storage quota. Upgrade now or delete old videos."
      },
      exceeded: {
        title: 'Quota Exceeded',
        message: 'Your storage quota is full. New uploads are blocked until you upgrade or free up space.'
      }
    },

    // Tiers
    tier: {
      free: 'Free',
      verified: 'Verified',
      premium: 'Premium',
      enterprise: 'Enterprise'
    },

    // Comparison
    tier_comparison: 'Compare Plans',
    current_plan: 'Current Plan',

    // History
    usage_history: 'Usage History',
    last_3_months: 'Last 3 Months',

    // Errors
    error_loading: 'Failed to load quota data',
    error_calculating: 'Error calculating quota'
  }
};
```

### Arabic Translations

```typescript
// apps/web/src/lib/i18n/translations/ar.ts

export const ar = {
  quota: {
    // Headings
    title: 'حصة التخزين',
    page_title: 'حصة التخزين والاستخدام',

    // Stats
    used: 'المستخدم',
    remaining: 'المتبقي',
    limit: 'الحد الأقصى',
    percentage: 'الاستخدام',

    // Dimensions
    storage_size: 'التخزين',
    video_count: 'الفيديوهات',
    upload_count: 'التحميلات',
    processing: 'وقت المعالجة',

    // Time
    resets_on: 'يتم التجديد في {date}',
    last_updated: 'آخر تحديث {time}',

    // Actions
    upgrade_now: 'الترقية الآن',
    view_details: 'عرض تفاصيل الحصة',
    manage_videos: 'إدارة الفيديوهات',
    upgrade_plan: 'ترقية الخطة',

    // Warnings
    warning: {
      warning: {
        title: 'اقتراب من حد الحصة',
        message: 'لقد استخدمت {percentage}٪ من حصة التخزين الخاصة بك. فكر في الترقية للحصول على مساحة أكبر.'
      },
      critical: {
        title: 'الحصة شبه ممتلئة',
        message: 'لقد استخدمت {percentage}٪ من حصة التخزين. قم بالترقية الآن أو احذف مقاطع الفيديو القديمة.'
      },
      exceeded: {
        title: 'تجاوز الحصة',
        message: 'حصة التخزين الخاصة بك ممتلئة. التحميلات الجديدة محظورة حتى تقوم بالترقية أو تحرير مساحة.'
      }
    },

    // Tiers
    tier: {
      free: 'مجاني',
      verified: 'موثق',
      premium: 'مميز',
      enterprise: 'مؤسسي'
    },

    // Comparison
    tier_comparison: 'مقارنة الخطط',
    current_plan: 'الخطة الحالية',

    // History
    usage_history: 'سجل الاستخدام',
    last_3_months: 'آخر 3 أشهر',

    // Errors
    error_loading: 'فشل تحميل بيانات الحصة',
    error_calculating: 'خطأ في حساب الحصة'
  }
};
```

---

## Appendix B: Configuration Examples

### Wrangler Configuration (Add KV Namespace)

```jsonc
// apps/api-videos/wrangler.jsonc

{
  "kv_namespaces": [
    {
      "binding": "AUTH_STORAGE",
      "id": "ff057deb522f4b2bb81006b42462f20e",
      "preview_id": "966e04e43b904ddeb26453291bf6c22d"
    },
    {
      "binding": "RATE_LIMIT_KV",
      "id": "PLACEHOLDER_RATE_LIMIT_KV_ID",
      "preview_id": "PLACEHOLDER_RATE_LIMIT_KV_PREVIEW_ID"
    },
    // ADD THIS:
    {
      "binding": "QUOTA_KV",
      "id": "PLACEHOLDER_QUOTA_KV_ID",
      "preview_id": "PLACEHOLDER_QUOTA_KV_PREVIEW_ID"
    }
  ]
}
```

### R2 Buckets (Add if needed)

```jsonc
{
  "r2_buckets": [
    // ... existing buckets ...

    // ADD IF NEEDED (optional - can use existing buckets):
    {
      "binding": "quota_storage",
      "bucket_name": "quota-storage",
      "preview_bucket_name": "quota-storage-preview",
      "remote": true
    }
  ]
}
```

---

## Document Control

- **Version**: 1.0
- **Created**: 2025-11-20
- **Author**: System Architect
- **Status**: Planning - Ready for Review
- **Next Review**: 2025-12-01
- **Stakeholders**: Development Team, Product Manager, UX Designer

---

## References

1. [YouTube Feature Comparison](/home/meywd/AlUmmahNow/docs/YOUTUBE_FEATURE_COMPARISON.md)
2. [Large File Handling Plan](/home/meywd/AlUmmahNow/docs/features/09-large-file-handling.md)
3. [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
4. [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
5. [React Query Documentation](https://tanstack.com/query/latest)
6. [Zod Validation](https://zod.dev/)

---

**END OF DOCUMENT**
