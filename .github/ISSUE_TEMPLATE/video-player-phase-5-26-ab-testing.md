---
name: "[Phase 5.5] A/B Testing Framework"
about: Implement A/B testing infrastructure for player features
title: "[Phase 5.5] Implement A/B Testing Framework"
labels: phase-5, video-player, testing, experimentation
assignees: ''
---

## Overview
Create A/B testing framework to experiment with player features, UI changes, and performance optimizations, allowing data-driven decisions.

## Acceptance Criteria
- [ ] Feature flag system implemented
- [ ] User cohort assignment (50/50 split)
- [ ] Variant tracking in analytics
- [ ] Statistical significance calculation
- [ ] Multiple concurrent experiments supported
- [ ] Easy rollout/rollback
- [ ] Admin UI for managing experiments
- [ ] Results dashboard
- [ ] Documentation for creating experiments
- [ ] CI/CD integration

## Implementation

```typescript
// apps/web/src/lib/experiments/ab-testing.ts
export interface Experiment {
  id: string;
  name: string;
  variants: ['control', 'variant'];
  traffic: number;  // 0-1
  active: boolean;
}

export class ABTestingService {
  private experiments: Map<string, Experiment> = new Map();
  private assignments: Map<string, string> = new Map();

  constructor() {
    this.loadExperiments();
    this.loadAssignments();
  }

  /**
   * Get variant for user
   */
  getVariant(experimentId: string, userId?: string): 'control' | 'variant' {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || !experiment.active) {
      return 'control';
    }

    // Check if user already assigned
    const assignmentKey = `${experimentId}:${userId || 'anonymous'}`;
    if (this.assignments.has(assignmentKey)) {
      return this.assignments.get(assignmentKey) as any;
    }

    // Assign variant
    const hash = this.hashUserId(userId || 'anonymous', experimentId);
    const variant = hash < experiment.traffic ? 'variant' : 'control';

    // Save assignment
    this.assignments.set(assignmentKey, variant);
    this.saveAssignments();

    // Track assignment
    this.trackAssignment(experimentId, variant, userId);

    return variant;
  }

  /**
   * Check if feature enabled for user
   */
  isEnabled(featureFlag: string, userId?: string): boolean {
    return this.getVariant(featureFlag, userId) === 'variant';
  }

  private hashUserId(userId: string, experimentId: string): number {
    // Simple hash function for consistent assignment
    const str = `${userId}:${experimentId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) / 2147483647;
  }

  private trackAssignment(experimentId: string, variant: string, userId?: string) {
    fetch('/api/analytics/experiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experimentId,
        variant,
        userId,
        timestamp: new Date().toISOString()
      })
    });
  }

  private loadExperiments() {
    // Load from API or static config
    const experiments: Experiment[] = [
      {
        id: 'custom_player_rollout',
        name: 'Custom Video Player',
        variants: ['control', 'variant'],
        traffic: 0.1,  // 10% of users
        active: true
      }
    ];

    experiments.forEach(exp => this.experiments.set(exp.id, exp));
  }

  private loadAssignments() {
    const stored = localStorage.getItem('abTestAssignments');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        Object.entries(parsed).forEach(([key, value]) => {
          this.assignments.set(key, value as string);
        });
      } catch (e) {
        console.error('Failed to load AB test assignments:', e);
      }
    }
  }

  private saveAssignments() {
    const obj = Object.fromEntries(this.assignments);
    localStorage.setItem('abTestAssignments', JSON.stringify(obj));
  }
}

// Singleton
export const abTesting = new ABTestingService();
```

**Usage in components:**
```typescript
export function VideoPage({ videoId }: { videoId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    authenticated().then(setUser);
  }, []);

  const useCustomPlayer = abTesting.isEnabled('custom_player_rollout', user?.id);

  return (
    <div>
      {useCustomPlayer ? (
        <CustomVideoPlayer videoId={videoId} />
      ) : (
        <LegacyIframePlayer videoId={videoId} />
      )}
    </div>
  );
}
```

**Analytics tracking:**
```typescript
// Track metrics by variant
analytics.trackEvent('video_play', {
  experiment: 'custom_player_rollout',
  variant: abTesting.getVariant('custom_player_rollout', userId),
  videoId
});
```

## Testing
- [ ] Consistent variant assignment
- [ ] 50/50 split verified
- [ ] Tracking works correctly
- [ ] Multiple experiments don't conflict
- [ ] Rollout/rollback tested

## Estimated Effort
**Medium** - 4-5 hours
