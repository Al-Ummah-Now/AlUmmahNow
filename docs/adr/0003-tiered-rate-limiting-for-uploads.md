# ADR 0003: Tiered Rate Limiting for Video Uploads

## Status
Proposed

## Context

Al Ummah Now needs to:
- Prevent abuse and excessive resource consumption
- Provide fair access to all users
- Offer premium tiers with higher limits
- Protect infrastructure from DDoS attacks
- Maintain quality of service during peak usage

Current implementation lacks comprehensive rate limiting, which could lead to:
- Single user monopolizing upload bandwidth
- Storage quota exhaustion
- Degraded performance for all users
- Potential cost overruns from excessive CDN usage

## Decision

Implement a **tiered rate limiting system** with:

1. **KV-based distributed rate limiting** (Cloudflare KV for state)
2. **Three user tiers**: Free, Pro, Enterprise
3. **Multiple limiting dimensions**: per-minute, per-hour, per-day, concurrent uploads
4. **Graceful degradation**: Clear feedback when limits reached
5. **Dynamic tier detection**: Based on user subscription status

### Rate Limit Tiers

| Tier | Per Minute | Per Hour | Per Day | Concurrent | Max File Size | Storage Quota |
|------|------------|----------|---------|------------|---------------|---------------|
| **Free** | 1 upload | 3 uploads | 10 uploads | 1 | 100 MB | 5 GB |
| **Pro** | 3 uploads | 20 uploads | 100 uploads | 3 | 2 GB | 100 GB |
| **Enterprise** | 10 uploads | 100 uploads | 1000 uploads | 10 | 5 GB | Unlimited |

### Implementation Architecture

```
┌─────────────────────────────────────────────┐
│              Rate Limiter                   │
│                                             │
│  1. Check user tier (from profile/sub)     │
│  2. Query KV for current usage             │
│  3. Apply sliding window algorithm         │
│  4. Update counters if allowed             │
│  5. Return decision with metadata          │
│                                             │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           Cloudflare KV Storage             │
│                                             │
│  Key: rate_limit:{userId}:{window}         │
│  Value: {                                  │
│    count: number,                          │
│    firstRequest: timestamp,                │
│    uploads: [...videoIds]                  │
│  }                                          │
│  TTL: window duration + buffer             │
│                                             │
└─────────────────────────────────────────────┘
```

## Rationale

### 1. KV Storage Choice
- **Global distribution**: Low latency worldwide
- **Automatic expiration**: TTL support for cleanup
- **Cost-effective**: Cheaper than Durable Objects for this use case
- **Simple API**: Easy to implement and maintain

### 2. Sliding Window Algorithm
- **Smooth rate limiting**: No thundering herd at window boundaries
- **Fair distribution**: Prevents gaming the system
- **User-friendly**: Gradual limit recovery

### 3. Multiple Dimensions
- **Per-minute**: Prevents rapid bursts
- **Per-hour**: Controls sustained usage
- **Per-day**: Enforces quotas
- **Concurrent**: Prevents resource hogging

### 4. Tiered Approach
- **Business model alignment**: Supports freemium strategy
- **User incentives**: Clear upgrade path
- **Resource protection**: Higher tiers for power users

## Consequences

### Positive

1. **Abuse Prevention**: Protects platform from malicious users
2. **Fair Access**: Ensures all users get reasonable service
3. **Predictable Costs**: Controls CDN and storage expenses
4. **Revenue Opportunity**: Premium tiers drive subscriptions
5. **Better UX**: Prevents system overload and degradation
6. **Clear Expectations**: Users understand their limits

### Negative

1. **Implementation Complexity**: Requires careful state management
   - *Mitigation*: Use battle-tested sliding window algorithm

2. **KV Costs**: Read/write operations have costs
   - *Mitigation*: Optimize key structure, use appropriate TTLs

3. **User Frustration**: Limits may annoy power users
   - *Mitigation*: Clear messaging, upgrade prompts

4. **Edge Cases**: Clock skew, distributed state issues
   - *Mitigation*: Add buffer time, eventual consistency handling

## Alternatives Considered

### 1. Token Bucket Algorithm (Rejected)
**Approach**: Fixed tokens replenished at constant rate
**Pros**: Allows bursts, simple concept
**Cons**:
- More complex state management
- Harder to explain to users
- Doesn't fit upload patterns well

### 2. Fixed Window Counters (Rejected)
**Approach**: Reset counters at fixed intervals
**Pros**: Simple implementation
**Cons**:
- Thundering herd problem
- Users can game the system at boundaries
- Poor user experience

### 3. Durable Objects (Rejected)
**Approach**: Use DO for rate limit state
**Pros**: Strong consistency, complex logic support
**Cons**:
- Overkill for simple counters
- Higher cost
- Single point of failure per user

### 4. No Rate Limiting (Current - Being Replaced)
**Approach**: Trust users to self-regulate
**Pros**: Simple, no implementation needed
**Cons**:
- Vulnerable to abuse
- Unpredictable costs
- Poor service quality during peaks

## Implementation Notes

### Rate Limiter Class

```typescript
class RateLimiter {
  constructor(
    private kv: KVNamespace,
    private limits: RateLimitConfig
  ) {}

  async check(userId: string, action: string): Promise<RateLimitResult> {
    const results = await Promise.all([
      this.checkWindow(userId, 'minute', this.limits.perMinute, 60),
      this.checkWindow(userId, 'hour', this.limits.perHour, 3600),
      this.checkWindow(userId, 'day', this.limits.perDay, 86400),
      this.checkConcurrent(userId, this.limits.concurrent)
    ]);

    const blocked = results.find(r => !r.allowed);
    if (blocked) return blocked;

    // Update all windows
    await Promise.all(
      results.map(r => this.incrementWindow(userId, r.window))
    );

    return { allowed: true, remaining: Math.min(...results.map(r => r.remaining)) };
  }

  private async checkWindow(
    userId: string,
    window: string,
    limit: number,
    duration: number
  ): Promise<WindowResult> {
    const key = `rate_limit:${userId}:${window}`;
    const data = await this.kv.get(key, 'json');

    const now = Date.now();
    const windowStart = now - (duration * 1000);

    if (!data || data.firstRequest < windowStart) {
      return { allowed: true, remaining: limit - 1, window };
    }

    const count = data.uploads.filter(t => t > windowStart).length;
    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      window,
      resetAt: new Date(data.firstRequest + duration * 1000)
    };
  }
}
```

### Error Response Format

```json
{
  "success": false,
  "error": "Upload rate limit exceeded",
  "rateLimitInfo": {
    "tier": "free",
    "limit": 3,
    "window": "hour",
    "remaining": 0,
    "resetAt": "2025-11-20T15:30:00Z",
    "upgradeUrl": "/pricing"
  }
}
```

### Monitoring & Alerts

1. **Metrics to track**:
   - Rate limit hits by tier
   - Upgrade conversions after limit hit
   - False positive rate
   - KV operation latency

2. **Alerts**:
   - Unusual spike in rate limit violations
   - KV errors or high latency
   - Potential abuse patterns

### User Communication

1. **Pre-upload check**: Show remaining uploads
2. **Clear error messages**: Explain limit and reset time
3. **Upgrade prompts**: Show benefits of higher tiers
4. **Dashboard**: Display usage statistics

## Migration Strategy

1. **Phase 1**: Implement rate limiter in monitoring mode (log only)
2. **Phase 2**: Enable for 10% of free tier users
3. **Phase 3**: Roll out to all free tier users
4. **Phase 4**: Implement for Pro/Enterprise tiers
5. **Phase 5**: Tune limits based on usage data

## Future Enhancements

1. **Dynamic limits**: Adjust based on system load
2. **Reputation system**: Reward good users with bonus uploads
3. **Burst allowance**: Temporary limit increases
4. **API rate limits**: Extend to all API endpoints
5. **Cost-based limiting**: Limit by estimated CDN costs

## References

- [Cloudflare: Rate Limiting Strategies](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Stripe: API Rate Limits](https://stripe.com/docs/rate-limits)
- [AWS: API Gateway Throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [Token Bucket vs Sliding Window](https://dev.to/satrobit/rate-limiting-using-the-sliding-window-algorithm-5fjn)

## Decision Date
2025-11-20

## Last Updated
2025-11-20