# Infrastructure & Cost Analysis

This document analyzes deployment options and costs for Al Ummah Now at various scales, including VPS feasibility and scaling to 1 million users.

## Table of Contents

- [Current Architecture](#current-architecture)
- [VPS Deployment Feasibility](#vps-deployment-feasibility)
- [Workerd Self-Hosting Option](#workerd-self-hosting-option)
- [Cost Analysis for 1M Users](#cost-analysis-for-1m-users)
- [Scaling Recommendations](#scaling-recommendations)

---

## Current Architecture

Al Ummah Now is built on **Cloudflare's edge computing platform** with the following services:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Cloudflare Workers | All 4 apps (web, api, processor, websocket) |
| **Data Storage** | Cloudflare R2 | 13+ buckets (videos, profiles, channels, etc.) |
| **Key-Value** | Cloudflare KV | Rate limiting, sessions, presence |
| **Message Queue** | Cloudflare Queues | Event processing, analytics |
| **WebSocket State** | Durable Objects | Real-time connections |
| **SQL Database** | Cloudflare D1 | Moderation, reports |
| **Video CDN** | Bunny.net | Video streaming (external) |
| **Auth** | OpenAuth | JWT authentication (external) |

---

## VPS Deployment Feasibility

### Short Answer: NOT Possible Without Major Refactoring

The codebase is deeply coupled to Cloudflare's platform and cannot run on a traditional VPS in its current state.

### Cloudflare Dependencies Requiring Replacement

| Service | Current (Cloudflare) | VPS Replacement |
|---------|---------------------|-----------------|
| **Runtime** | Workers (all 4 apps) | Node.js |
| **Data Storage** | R2 (13+ buckets as "database") | PostgreSQL/MongoDB + S3/MinIO |
| **Key-Value** | Cloudflare KV | Redis |
| **Message Queue** | Cloudflare Queues | RabbitMQ/BullMQ |
| **WebSocket State** | Durable Objects | Redis + Socket.IO |
| **SQL Database** | D1 | PostgreSQL |
| **Next.js Adapter** | `@opennextjs/cloudflare` | Standard `next start` |

### Refactoring Effort for Full VPS Migration

| App | Effort | Changes Needed |
|-----|--------|----------------|
| **web** | Medium | Replace adapter, change env handling |
| **api-videos** | **High** | Rewrite all R2 repository code (~15 files), add actual database |
| **processor** | **High** | Replace queue consumer, new message broker |
| **websocket-server** | **Very High** | Complete rewrite - Durable Objects have no equivalent |

**Total Files Impacted:** ~60-80 files
**Estimated Refactoring Time:** 3-6 weeks for experienced developer

### Minimum VPS Specifications (If Refactored)

**Development/Low Traffic:**
```
CPU:     2 vCPUs
RAM:     4GB
Storage: 50GB SSD (code only)
OS:      Ubuntu 22.04 LTS
Note:    Videos still need external storage (Bunny.net, S3)
```

**Production (Single Server):**
```
CPU:     4 vCPUs
RAM:     8GB
Storage: 100GB NVMe SSD
OS:      Ubuntu 22.04 LTS
```

**Production (Distributed):**
```
Web Server:        2 vCPU / 2GB RAM
API Server:        2 vCPU / 4GB RAM
WebSocket Server:  2 vCPU / 2GB RAM
Queue Processor:   1 vCPU / 1GB RAM
PostgreSQL:        2 vCPU / 4GB RAM
Redis:             1 vCPU / 2GB RAM
─────────────────────────────────────
Total:             10 vCPU / 15GB RAM
```

---

## Workerd Self-Hosting Option

**Workerd** is Cloudflare's open-source Workers runtime that can be self-hosted on any Linux server.

### What Workerd CAN Run

| Component | Workerd Compatible? | Notes |
|-----------|---------------------|-------|
| **api-videos** (Hono) | Yes | Core Worker logic works |
| **web** (Next.js) | Yes | With @opennextjs/cloudflare |
| **processor** | Partial | Worker code yes, queue binding no |
| **websocket-server** | Partial | Worker code yes, Durable Objects no |

### What Workerd CANNOT Provide

These Cloudflare platform services have **no workerd equivalent**:

| Service | Status | VPS Alternative |
|---------|--------|-----------------|
| **R2 Storage** | Not included | MinIO (S3-compatible) |
| **KV** | Not included | Redis |
| **Queues** | Not included | RabbitMQ/BullMQ |
| **Durable Objects** | Not included | Redis + custom state |
| **D1 Database** | Not included | SQLite/PostgreSQL |

### VPS Architecture with Workerd

```
┌─────────────────────────────────────────────────────┐
│                      VPS                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  workerd    │  │  workerd    │  │  workerd    │ │
│  │  (web)      │  │  (api)      │  │  (websocket)│ │
│  │  :3001      │  │  :3086      │  │  :3087      │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │        │
│  ┌──────┴────────────────┴────────────────┴──────┐ │
│  │              Supporting Services              │ │
│  │  ┌────────┐  ┌────────┐  ┌────────┐          │ │
│  │  │ MinIO  │  │ Redis  │  │Postgres│          │ │
│  │  │ (R2)   │  │(KV+Q)  │  │ (D1)   │          │ │
│  │  └────────┘  └────────┘  └────────┘          │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Refactoring Effort with Workerd

| Task | Effort | Time Estimate |
|------|--------|---------------|
| Create R2 → MinIO adapter | Medium | 2-3 days |
| Create KV → Redis adapter | Low | 1 day |
| Create Queue → BullMQ adapter | Medium | 2-3 days |
| Replace Durable Objects | High | 1-2 weeks |
| Workerd configuration | Low | 1-2 days |
| Testing & debugging | Medium | 1 week |
| **Total** | | **3-4 weeks** |

### Workerd Advantage

Unlike a full Node.js rewrite, workerd lets you keep your existing Worker code largely intact. You only need to write **adapter layers** for the platform services (R2, KV, Queues). The business logic in your endpoints remains unchanged.

---

## Cost Analysis for 1M Users

### Usage Assumptions

| Metric | Value | Reasoning |
|--------|-------|-----------|
| **Registered Users** | 1,000,000 | Target scale |
| **DAU (Daily Active)** | 200,000 (20%) | Typical for content platforms |
| **Peak Concurrent** | 20,000 (10% of DAU) | During popular content/events |
| **API Requests/User/Day** | 50 | Browse, search, video pages |
| **Video Views/User/Day** | 3 | Average for video platform |
| **WebSocket Connections** | 20,000 | Peak concurrent |
| **Avg Video Length** | 15 min | Islamic lectures/content |

### Daily Traffic Estimates

```
API Requests:     200,000 DAU × 50 = 10,000,000/day = 300M/month
Video Views:      200,000 DAU × 3  = 600,000/day = 18M/month
WebSocket msgs:   20,000 × 100/hr × 12hr = 24M/day = 720M/month
Queue messages:   ~20M/month (views, likes, analytics)
```

### Cloudflare Pricing (Workers Paid Plan)

| Service | Usage | Unit Price | Monthly Cost |
|---------|-------|------------|--------------|
| **Workers** (requests) | 300M | $0.30/M after 10M | **$87** |
| **Workers** (CPU time) | ~50M ms | $0.02/M ms | **$1,000** |
| **R2 Storage** | 500GB | $0.015/GB | **$7.50** |
| **R2 Operations** | 100M Class A | $4.50/M | **$450** |
| **R2 Operations** | 500M Class B | $0.36/M | **$180** |
| **KV Reads** | 200M | $0.50/M | **$100** |
| **KV Writes** | 50M | $5.00/M | **$250** |
| **Queues** | 20M msgs | $0.40/M | **$8** |
| **Durable Objects** (requests) | 100M | $0.15/M | **$15** |
| **Durable Objects** (duration) | 50M GB-s | $12.50/M | **$625** |
| **D1 Database** | 50GB + queries | ~$50 | **$50** |
| **Workers Paid Plan** | Base | $5/month | **$5** |

**Cloudflare Subtotal: ~$2,778/month**

### Bunny.net (Video CDN) - Required Either Way

| Service | Usage | Unit Price | Monthly Cost |
|---------|-------|------------|--------------|
| **Video Bandwidth** | 50TB | $0.01/GB | **$500** |
| **Stream Storage** | 5TB | $0.005/GB | **$25** |
| **Encoding** | 18M views | Included | $0 |

**Bunny.net Subtotal: ~$525/month**

### Total Cloudflare Stack (1M Users)

```
Cloudflare Services:  $2,778
Bunny.net CDN:        $  525
──────────────────────────────
TOTAL:                $3,303/month
```

**Note:** CPU time is the biggest cost driver. Each API request doing JSON parsing, auth validation, and R2 operations uses ~0.5-2ms of CPU. At 300M requests, this adds up fast.

---

### Self-Hosted (Workerd + VPS) Cost Breakdown

#### Infrastructure Requirements

| Component | Specs | Quantity |
|-----------|-------|----------|
| **API Servers** | 8 vCPU, 16GB RAM | 4 |
| **Web Servers** | 4 vCPU, 8GB RAM | 2 |
| **WebSocket Servers** | 4 vCPU, 8GB RAM | 2 |
| **Queue Workers** | 2 vCPU, 4GB RAM | 2 |
| **PostgreSQL** | 8 vCPU, 32GB RAM | 2 (primary + replica) |
| **Redis Cluster** | 4 vCPU, 16GB RAM | 3 nodes |
| **MinIO (S3)** | 4 vCPU, 8GB RAM + 2TB | 4 nodes |
| **Load Balancer** | Managed | 1 |

#### VPS Pricing (Hetzner - Best Value)

| Component | Specs | Unit Cost | Monthly |
|-----------|-------|-----------|---------|
| **API Servers** (4×) | CCX33 (8c/32GB) | €65 | **€260** |
| **Web Servers** (2×) | CCX23 (4c/16GB) | €35 | **€70** |
| **WebSocket** (2×) | CCX23 (4c/16GB) | €35 | **€70** |
| **Queue Workers** (2×) | CCX13 (2c/8GB) | €18 | **€36** |
| **PostgreSQL** (2×) | CCX33 (8c/32GB) | €65 | **€130** |
| **Redis** (3×) | CCX23 (4c/16GB) | €35 | **€105** |
| **MinIO** (4×) | CCX23 + 500GB | €50 | **€200** |
| **Load Balancer** | Managed | €15 | **€15** |
| **Bandwidth** | 50TB | €1/TB | **€50** |
| **Backups** | ~500GB | | **€50** |

**Hetzner Subtotal: €986/month (~$1,070)**

#### Alternative Providers

| Provider | Similar Setup | Monthly Cost |
|----------|--------------|--------------|
| **Hetzner** | As above | ~$1,070 |
| **DigitalOcean** | Droplets + Managed DBs | ~$2,500 |
| **AWS** | EC2 + RDS + ElastiCache | ~$4,000 |
| **GCP** | Compute + Cloud SQL | ~$3,500 |

#### Total Self-Hosted Stack (1M Users)

```
Hetzner Infrastructure:  $1,070
Bunny.net CDN:           $  525
DevOps/Maintenance:      $  500 (estimate: your time or contractor)
──────────────────────────────────────────
TOTAL:                   $2,095/month
```

---

### Cost Comparison Summary

| Scale | Cloudflare | Self-Hosted (Hetzner) | Savings |
|-------|------------|----------------------|---------|
| **1M users** | $3,303/mo | $2,095/mo | **37% cheaper** |
| **Annual** | $39,636 | $25,140 | **$14,496/year** |

### Scaling Curves

| Users | Cloudflare | Self-Hosted |
|-------|------------|-------------|
| 100K | $400 | $600 |
| 250K | $900 | $800 |
| 500K | $1,700 | $1,200 |
| **1M** | **$3,300** | **$2,100** |
| 2M | $6,500 | $3,500 |
| 5M | $15,000 | $7,000 |

**Crossover Point:** Cloudflare is cheaper below ~200K users due to generous free tiers. Above 300K users, self-hosted becomes increasingly cost-effective. At 1M+ users, you save 30-50% with self-hosting, but you need DevOps expertise.

---

## Scaling Recommendations

### Cloudflare Advantages

| Factor | Impact |
|--------|--------|
| No DevOps needed | Save $5-10K/month in staff |
| Auto-scaling | Handle traffic spikes |
| Global edge | Low latency worldwide |
| Managed security | DDoS protection included |

### Cloudflare Disadvantages at Scale

| Factor | Impact |
|--------|--------|
| CPU costs unpredictable | Can spike with complex logic |
| Vendor lock-in | Hard to migrate later |
| R2 operation costs | Expensive at high read volumes |

### Self-Hosted Advantages

| Factor | Impact |
|--------|--------|
| Predictable costs | Fixed monthly bill |
| No per-request charges | Unlimited within capacity |
| Full control | Optimize as needed |
| Data sovereignty | Control data location |

### Self-Hosted Disadvantages

| Factor | Impact |
|--------|--------|
| DevOps required | $3-8K/month for engineer |
| Scaling complexity | Manual capacity planning |
| Downtime risk | Your responsibility |
| Security management | Your responsibility |

---

### Recommendation by Scenario

| Your Situation | Recommendation |
|----------------|----------------|
| **Bootstrapped startup** | Cloudflare (no DevOps needed) |
| **Have DevOps team** | Self-hosted at 500K+ users |
| **Unpredictable traffic** | Cloudflare (auto-scales) |
| **Tight budget, 1M users** | Self-hosted saves ~$15K/year |
| **Global audience** | Cloudflare (edge locations) |
| **MENA-focused** | Self-hosted in EU (Hetzner) fine |

---

## Summary

| Option | Monthly Cost (1M) | Annual Cost | Effort Level |
|--------|-------------------|-------------|--------------|
| **Cloudflare** | $3,300 | $39,600 | Low (managed) |
| **Self-Hosted** | $2,100 | $25,200 | High (need DevOps) |
| **Savings** | $1,200/mo | **$14,400/yr** | +DevOps cost |

**Bottom Line:** At 1M users, if you have or can hire DevOps capability, self-hosting saves significant money. If you're a small team focused on product, Cloudflare's premium is worth the operational simplicity.

---

## External Services (Required Regardless of Deployment)

These external dependencies remain the same whether on Cloudflare or VPS:

1. **Bunny.net** - Video streaming CDN (~$500-1000/month at scale)
2. **OpenAuth** - Authentication service (auth.alummahnow.net)
3. **Domain/DNS** - alummahnow.net

---

*Document created: January 2026*
*Last updated: January 2026*
