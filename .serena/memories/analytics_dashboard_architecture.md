# Analytics Dashboard & Infrastructure Architecture (2025-01-25)

## Overview
Full platform observability, billing, and infrastructure management system.

## Key Corrections Applied

1. **Costs are ESTIMATED** - Providers don't give real-time cost APIs
2. **Collect raw metrics** (bytes, minutes, tokens) then calculate costs
3. **Apply 20-50% markup** on top of base costs for operational overhead
4. **AI Search is SYSTEM feature** - always on, tracked for costs, not user-toggleable

## Key Components

### 1. Cost Philosophy
- Collect raw metrics → Apply rate tables → Add markup
- Rate tables configurable per provider
- Markup: Storage 25%, Bandwidth 20%, Transcription 35%, AI Search 40%, GPU 50%

### 2. System Analytics Dashboard
- Platform health (uptime, latency, error rate)
- Cost tracking by provider (Bunny, Cloudflare, RunPod)
- Storage metrics (R2, Bunny, D1)
- Processing queue status

### 2. Cost Management
- Per-video cost breakdown (storage, transcription, bandwidth)
- Cost forecasting based on growth rate
- Budget alerts
- Provider API integration for actual costs

### 3. Subscription Tiers
- Free: 5GB, 60min/mo upload, basic features
- Creator ($9.99): 100GB, transcription, AI search
- Professional ($29.99): 1TB, all features, priority
- Organization ($99.99): 10TB, enterprise

### 4. Feature Types
**System Features** (always on, admin tracks costs):
- AI Search (Vectorize) - 40% markup
- Analytics Engine - 25% markup  
- Content Indexing (D1) - 25% markup

**User Features** (toggleable, per-user billing):
- Transcription: $0.026/min (base $0.019 + 35% markup)
- Live Streaming: $0.65/hr (base $0.50 + 30% markup)
- Priority Processing: Tier-included
- Custom Branding: Tier-controlled
- API Access: Tier-controlled

### 5. Infrastructure Orchestration
- RunPod job management (submit, status, cancel)
- Concurrent job limiting (max 10)
- Webhook handling for completion
- Cost tracking per job

### 6. Resilience Patterns
- Circuit breaker (5 failures → open, 1 min recovery)
- Retry with exponential backoff (1s, 4s, 16s)
- Dead letter queue for failed messages
- Admin replay functionality

## D1 Tables
- provider_costs, cost_allocations, budget_alerts
- user_subscriptions, user_usage, overage_charges
- feature_flags, channel_features
- runpod_jobs, dead_letter_queue

## Implementation: 10 weeks
1-2: Core metrics
3-4: User billing + Stripe
5: Feature flags
6-7: RunPod orchestration
8: Resilience
9-10: Polish

## New: Admin App (apps/admin)
- Separate Next.js app in monorepo
- Real-time cost estimation dashboard
- System toggles management
- Job queue monitoring
- User/subscription management

## StreamPot (Self-Hosted Audio Extraction)
- Open-source FFmpeg API (MIT License)
- **Acquired by ittybit.com but still self-hostable!**
- Requirements: Node.js 20+, PostgreSQL, Redis, FFmpeg (Docker)
- Can use Cloudflare R2 for S3 storage!
- Self-host on Hetzner €4/mo (~€50/year)
- GitHub: https://github.com/StreamPot/StreamPot

## Ittybit (StreamPot's acquirer)
- Managed media API at ittybit.com
- Credits-based: $1/1k credits
- Audio extraction: 2 credits/min = $36,000 for 200k videos
- **Too expensive - self-host StreamPot instead**

## Implementation: 12 weeks
1-2: Metrics collection
3-4: Admin app setup
5-6: Subscriptions & quotas
7-8: Infrastructure (StreamPot + RunPod)
9-10: Resilience & monitoring
11-12: Polish & documentation

## Full Doc
See: docs/research/analytics-dashboard-architecture.md
