# Al Ummah Now - Scheduler Worker

Automated video publishing scheduler for Al Ummah Now platform.

## Overview

This Cloudflare Worker runs on a cron schedule (every minute) to automatically publish videos that have been scheduled for publication at a specific date and time.

## Features

- Automatic video publishing at scheduled times
- Timezone-aware scheduling
- Retry mechanism for failed publishes (exponential backoff)
- Distributed locking to prevent duplicate publishes
- Comprehensive monitoring and health checks
- Queue-based event logging

## Architecture

### Cron Trigger
- Runs every minute (`* * * * *`)
- Checks R2 bucket for videos scheduled in the current time window
- Processes videos in batches with concurrency control

### R2 Buckets
- **VIDEOS**: Main video storage bucket
- **SCHEDULED_VIDEOS**: Scheduling metadata storage
  - Key format: `{year}-{month}-{day}/{hour}/{videoId}.json`
  - Example: `2025-01-20/14/abc123.json`

### KV Namespaces
- **SCHEDULER_LOCKS**: Distributed locks for preventing duplicate processing
- **SCHEDULER_METRICS**: Real-time metrics and health data

### Queue
- **QUEUE**: Publishes events for analytics (success, failure, retries)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_RETRIES` | `3` | Maximum retry attempts for failed publishes |
| `BATCH_SIZE` | `50` | Maximum videos to process per run |
| `LOCK_TTL` | `120` | Lock time-to-live in seconds |
| `WEBSOCKET_URL` | Production URL | WebSocket server for notifications |

## Development

```bash
# Install dependencies
pnpm install

# Start local development
pnpm dev

# Type check
pnpm type-check

# Lint
pnpm lint
```

## Deployment

```bash
# Deploy to production
pnpm deploy

# Deploy to staging
pnpm deploy:staging
```

## How It Works

1. **Cron Trigger**: Every minute, the scheduler wakes up
2. **Time Window**: Calculate current minute window (e.g., 14:05:00 to 14:05:59)
3. **Query Scheduled Videos**: List all videos in R2 bucket for current time window
4. **Acquire Locks**: Use distributed locking to prevent duplicate processing
5. **Publish Videos**: Update video status to public, set publishedAt timestamp
6. **Send Notifications**: Notify users if requested
7. **Log Events**: Queue success/failure events for analytics
8. **Retry on Failure**: Exponential backoff retry mechanism (1, 2, 4, 8 minutes)
9. **Cleanup**: Remove successfully published videos from scheduled bucket

## Monitoring

### Health Checks
- Last run timestamp stored in KV
- Alerts if scheduler hasn't run in 5 minutes
- Failure rate monitoring

### Metrics
- Total scheduled videos
- Published today count
- Failed today count
- Average publish delay (scheduled vs actual)
- Queue depth

### Alerts
- Scheduler stopped running
- High failure rate (>1%)
- Average delay >120 seconds
- Queue depth >1000

## Error Handling

### Retry Logic
1. **First failure**: Retry in 1 minute
2. **Second failure**: Retry in 2 minutes
3. **Third failure**: Retry in 4 minutes
4. **Fourth failure**: Mark as permanently failed, send alert

### Permanent Failures
- Video marked with `scheduledPublishStatus: 'failed'`
- Error message stored in metadata
- User notified via email/in-app notification

## Testing

```bash
# Run unit tests
pnpm test

# Test scheduler locally with Miniflare
pnpm dev
# Trigger cron: wrangler dev --test-scheduled
```

## Key Files

- `src/index.ts` - Main cron handler
- `src/publisher.ts` - Video publishing logic
- `src/retry.ts` - Retry mechanism
- `src/monitoring.ts` - Health checks and metrics
- `src/locks.ts` - Distributed locking
- `src/notifier.ts` - Notification service
- `src/types.ts` - TypeScript interfaces

## Security

- JWT validation for API requests (if needed)
- Rate limiting on publishes (100 per minute)
- Distributed locking to prevent race conditions
- Audit logging for all publish operations

## Performance

- Processes up to 50 videos per minute
- Parallel processing with concurrency limit (10 concurrent)
- Minimal CPU time: ~50ms per run
- Estimated cost: $10-15/month

## Dependencies

- `@al-ummah/shared-types` - Shared TypeScript types
- `@cloudflare/workers-types` - Cloudflare Workers types

## Troubleshooting

### Scheduler not running
1. Check Cloudflare dashboard for cron trigger status
2. Verify KV namespace bindings
3. Check R2 bucket permissions
4. Review worker logs

### Videos not publishing
1. Verify scheduled metadata exists in R2
2. Check lock acquisition (may be stuck)
3. Review error logs in queue
4. Test manually with wrangler dev

### High failure rate
1. Check R2 bucket availability
2. Verify video data integrity
3. Review error messages in failed metadata
4. Check queue capacity

## Support

For issues or questions, contact the platform team or open a GitHub issue.
