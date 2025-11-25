# Research Documents

This directory contains research findings for Al Ummah Now platform decisions.

## Documents

### [Analytics Dashboard & Infrastructure Architecture](./analytics-dashboard-architecture.md)
**Date**: 2025-01-25

Comprehensive system for platform observability and management:
- **Metrics-first cost estimation** (collect raw metrics → apply rate tables → add 20-50% markup)
- **Admin app** (`apps/admin`) - New monorepo app for platform management
- **Real-time cost dashboard** - Live cost tracking with projections
- **System toggles** - Admin controls transcription, AI search ON/OFF platform-wide
- **Quotas** - Per-tier limits (videos/week, live streams/week, storage)
- **Tier features** - Subscription-gated (sections, shorts, community, etc.)
- **StreamPot integration** - Self-hosted FFmpeg for audio extraction
- **RunPod integration** - GPU for Whisper transcription only
- **Resilience** - Circuit breakers, retries, dead letter queue
- **12-week implementation roadmap**

**Key Decisions**:
- Costs are ESTIMATED (providers don't give real-time APIs)
- AI Search is SYSTEM feature (always on, admin tracks costs)
- Transcription is SYSTEM TOGGLE (admin can enable/disable platform-wide)
- StreamPot (€4/mo) for audio extraction, RunPod for Whisper only

---

### [Transcription & AI Search Architecture](./transcription-and-search-architecture.md)
**Date**: 2025-01-25

Research on implementing transcription and semantic search at 30TB scale:
- Transcription provider comparison (Bunny, Cloudflare, RunPod, Sonix, AWS, Google)
- Audio extraction methods (WebAudio API, FFmpeg, server-side)
- AI search with Vectorize + bge-m3 (Arabic + English)
- Compute providers (Fly.io, RunPod, Lambda, Vast.ai)
- Privacy policies
- Cost analysis and implementation roadmap

**Key Decision**: RunPod self-hosted Whisper (~$3,400) vs Bunny Transcribe AI (~$1.8M)

---

### [Video Hosting Alternatives](./video-hosting-alternatives.md)
**Date**: 2025-01-25

Evaluation of video hosting providers for 30TB scale:
- Bunny.net (current)
- Cloudflare Stream
- DynTube (73% cheaper)
- Mux
- api.video

**Key Decision**: Stay with Bunny.net ($300/month) - best value at scale

---

### [Infrastructure Orchestration](./infrastructure-orchestration.md)
**Date**: 2025-11-25

StreamPot + RunPod infrastructure automation from admin app:
- **RunPod GraphQL API** - Pod lifecycle, serverless endpoint scaling, billing queries
- **Hetzner Cloud API** - Server provisioning, power actions, metrics
- **Cloud-init scripts** - Auto-deploy StreamPot on new Hetzner servers
- **Admin API endpoints** - Infrastructure control from dashboard
- **D1 schema** - Track servers, actions, costs
- **Health checks** - Scheduled worker every 5 minutes

**Key APIs**:
- RunPod: `https://api.runpod.io/graphql` (Bearer auth)
- Hetzner: `https://api.hetzner.cloud/v1` (Bearer auth)

---

### [Admin App Specification](./admin-app-specification.md)
**Date**: 2025-11-25

Complete specification for `apps/admin` platform management dashboard:
- **Magic link authentication** - Separate from user auth (OpenAuth)
- **Cost dashboard** - Real-time tracking, projections, margins
- **System toggles** - Transcription, AI search ON/OFF
- **User management** - Subscriptions, usage, quotas
- **Job queue monitor** - RunPod jobs, retry/cancel
- **Dead letter queue** - Replay, resolve failed messages
- **Infrastructure automation** - Hetzner/RunPod control

**Key Features**:
- Next.js 15 + React 19 on Cloudflare Workers
- D1 for admin data, KV for session cache
- Service binding to api-videos (no network hop)
- Polling (30s) for real-time feel

---

### [Subscription System Schema](./subscription-system-schema.md)
**Date**: 2025-11-25

D1 schema for subscription billing and quota enforcement:
- User subscriptions with Stripe integration
- Usage tracking per period
- Overage charges
- Tier definitions with quotas and features

---

## Related ADRs

- [ADR-0005: Hybrid Data Layer Architecture](../adr/0005-d1-database-integration.md) - D1 + Analytics Engine + Vectorize architecture
- [ADR-0006: Metrics and Cost Estimation](../adr/0006-metrics-and-cost-estimation.md) - Metrics collection, rate tables, markup configuration

## Summary of Decisions

| Area | Decision | Cost |
|------|----------|------|
| Video Hosting | Bunny.net | $300/month |
| Transcription | RunPod Whisper | $3,400 one-time |
| Audio Extraction | RunPod FFmpeg | $600 one-time |
| AI Search | Cloudflare Vectorize | $5/month |
| Database Index | Cloudflare D1 | $5/month |
| Analytics | Cloudflare Analytics Engine | Included |

**Total: ~$4,000 one-time + ~$310/month**

## Subscription Tiers

| Tier | Price | Storage | Key Features |
|------|-------|---------|--------------|
| Free | $0 | 5 GB | Basic features |
| Creator | $9.99/mo | 100 GB | Transcription, AI Search |
| Professional | $29.99/mo | 1 TB | All features, Priority |
| Organization | $99.99/mo | 10 TB | Enterprise, API access |

## Architecture Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Data Store | R2 | Source of truth |
| Query Index | D1 | Fast filtering, pagination |
| Counters | Analytics Engine | Views, likes, real-time stats |
| Search | Vectorize + bge-m3 | Semantic search (AR/EN) |
| Audio Extraction | StreamPot (Hetzner) | FFmpeg as a service |
| Transcription | RunPod | Whisper on GPU |
| Feature Flags | D1 + KV | Per-user/channel toggles |
| Billing | Stripe | Subscriptions, overages |
| Admin Dashboard | apps/admin | Infrastructure automation, costs |
| Resilience | Circuit breakers, DLQ | Fault tolerance |
