# Transcription & AI Search Architecture Research

**Date**: 2025-01-25
**Context**: YouTube-replacement platform with 30TB of video content (~200,000 videos, 1-2 hours each)

## Executive Summary

For a 30TB video platform requiring transcription and AI-powered search:
- **Best transcription approach**: RunPod self-hosted Whisper (~$3,400 one-time)
- **Best search approach**: Cloudflare Vectorize with bge-m3 embeddings (Arabic + English)
- **Best data architecture**: Hybrid R2 + D1 + Analytics Engine + Vectorize

## Scale Assumptions

| Metric | Value |
|--------|-------|
| Total videos | ~200,000 |
| Average video length | 1.5 hours |
| Total video hours | ~300,000 hours |
| Total storage | 30 TB |
| Languages | Arabic (primary), English |

---

## 1. Transcription Options Compared

### Pricing Comparison (for 300,000 hours of audio)

| Provider | Cost per Minute | Total Cost | Notes |
|----------|-----------------|------------|-------|
| **Bunny.net Transcribe AI** | $0.10 | $1,800,000 | Built into Bunny, easy but expensive |
| **Sonix.ai** | $0.083-$0.167 | $1,500,000-$3,000,000 | Good Arabic, API available |
| **Cloudflare Workers AI Whisper** | $0.0005 | $9,000 | Managed, no GPU needed |
| **RunPod Self-Hosted Whisper** | ~$0.00019 | $3,400 | Cheapest, requires setup |
| **AWS Transcribe** | $0.024 | $432,000 | Good Arabic support |
| **Google Cloud Speech** | $0.016 | $288,000 | Excellent Arabic |

### Winner: RunPod Self-Hosted Whisper

**Cost calculation**:
```
Whisper large-v3 on RTX 4090: ~30x realtime speed
Processing time: 300,000 hours ÷ 30 = 10,000 GPU hours
Cost: 10,000 hours × $0.34/hr = $3,400
```

**Advantages**:
- 63% cheaper than Cloudflare Workers AI
- Full control over model and parameters
- Can batch process efficiently
- No per-minute API fees

---

## 2. Audio Extraction Options

### Why Audio Extraction is Needed

Whisper requires audio input, not video. Options for extracting audio:

| Method | Location | Speed | Cost | Max Video Size |
|--------|----------|-------|------|----------------|
| **WebAudio API** | Browser | 4x realtime | FREE | Unlimited |
| **FFmpeg on Fly.io** | Server | 10-50x realtime | ~$800 | Unlimited |
| **FFmpeg on RunPod** | GPU Server | 10-50x realtime | FREE (same GPU) | Unlimited |
| **FFmpeg WASM in Worker** | Edge | 1x realtime | FREE | <50MB |
| **Cloudflare Stream** | CDN | Instant | Stream pricing | Unlimited |

### Winner: RunPod (Same GPU for extract + transcribe)

Run FFmpeg and Whisper on the same RunPod instance:
- No additional extraction cost
- No data transfer between services
- Single pipeline

### Browser Extraction (for short videos <10 min)

```typescript
// WebAudio API - works in browser only, NOT in Workers
const video = document.createElement('video');
video.src = videoUrl;
video.playbackRate = 4.0; // 4x speed extraction

const audioContext = new AudioContext();
const source = audioContext.createMediaElementSource(video);
const destination = audioContext.createMediaStreamDestination();
source.connect(destination);

const mediaRecorder = new MediaRecorder(destination.stream, {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 64000,
});

mediaRecorder.start(10000); // 10 second chunks
video.play();
```

**Note**: WebAudio API does NOT work in Cloudflare Workers (browser-only API).

---

## 3. AI Search Architecture

### Multilingual Embedding Model

**Recommended**: `@cf/baai/bge-m3` on Cloudflare Workers AI

| Model | Arabic Support | Dimensions | Context | Cost |
|-------|---------------|------------|---------|------|
| **bge-m3** | ✅ Excellent | 1024 | 8192 tokens | $0.00001/1k tokens |
| bge-large-en | ❌ English only | 1024 | 512 tokens | $0.00001/1k tokens |
| OpenAI ada-002 | ⚠️ Limited | 1536 | 8191 tokens | $0.0001/1k tokens |

### Vectorize Configuration

```toml
# wrangler.toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "video-transcripts"

[vectorize.config]
dimensions = 1024
metric = "cosine"
```

### Search Flow

```
User Query (Arabic/English)
        │
        ▼
┌─────────────────┐
│  bge-m3 Embed   │  Cloudflare Workers AI
└────────┬────────┘
         │ 1024-dim vector
         ▼
┌─────────────────┐
│   Vectorize     │  Semantic search
│   (Top 20)      │
└────────┬────────┘
         │ video IDs + scores
         ▼
┌─────────────────┐
│      D1         │  Fetch metadata
│   (Hydrate)     │
└────────┬────────┘
         │
         ▼
    Search Results
```

---

## 4. Data Layer Architecture

### Hybrid Approach: R2 + D1 + Analytics Engine + Vectorize

| Layer | Purpose | Data |
|-------|---------|------|
| **R2** | Source of truth | Full video/channel/playlist objects |
| **D1** | Queryable indexes | Metadata, foreign keys, search fields |
| **Analytics Engine** | High-frequency counters | Views, likes, real-time stats |
| **Vectorize** | Semantic search | Transcript embeddings |

### Data Flow

```
Write Path:
  API Request → R2 (full object) → Queue → D1 (index) + Analytics Engine

Read Path:
  API Request → D1 (query/filter) → R2 (hydrate if needed)

Search Path:
  Query → Vectorize (semantic) → D1 (metadata) → Response

Analytics Path:
  Event → Analytics Engine (increment) → Periodic sync to R2
```

---

## 5. Compute Provider Comparison

### For Audio Extraction + Transcription

| Provider | GPU Cost/hr | Bandwidth | Setup | Best For |
|----------|-------------|-----------|-------|----------|
| **RunPod** | $0.34 (4090) | FREE | Easy | Batch processing |
| **Fly.io** | N/A (CPU only) | $0.02/GB | Easy | FFmpeg only |
| **Lambda Labs** | $0.50 (4090) | FREE | Medium | Long jobs |
| **Vast.ai** | $0.20-0.40 | Varies | Complex | Cheapest spot |
| **AWS** | $1.50+ | $0.09/GB | Complex | Enterprise |

### Winner: RunPod

- Cheapest for GPU workloads
- No egress fees
- Easy serverless deployment
- Pre-built Whisper templates

---

## 6. Privacy & Compliance

### Data Privacy by Provider

| Provider | Trains on Data? | Data Sold? | GDPR | Data Location |
|----------|-----------------|------------|------|---------------|
| Cloudflare | ❌ No | ❌ No | ✅ Yes | Global/EU |
| RunPod | ❌ No | ❌ No | ✅ Yes | US/EU |
| Fly.io | ❌ No | ❌ No | ✅ Yes | Choose region |
| Bunny.net | ❌ No | ❌ No | ✅ Yes | EU |

### Cloudflare Workers AI Specific

From [Cloudflare AI Privacy Policy](https://developers.cloudflare.com/workers-ai/privacy/):
> "Cloudflare does not train models on customer data. Your inference data is not stored or logged beyond the duration of the request."

---

## 7. Cost Summary

### One-Time Processing Costs (200,000 videos)

| Component | Cost |
|-----------|------|
| RunPod GPU (extract + transcribe) | $3,400 |
| Vectorize indexing | ~$100 |
| D1 initial sync | ~$50 |
| **Total One-Time** | **~$3,550** |

### Monthly Operating Costs

| Component | Cost/Month |
|-----------|------------|
| Bunny.net Storage (30TB) | $300 |
| Bunny.net Bandwidth | Variable |
| Cloudflare D1 | $5 |
| Cloudflare Vectorize | $5 |
| Cloudflare Analytics Engine | Included |
| **Total Monthly** | **~$310+** |

### Comparison: If Using Bunny Transcribe AI

| Approach | One-Time | Monthly |
|----------|----------|---------|
| RunPod + Cloudflare | $3,550 | $310 |
| Bunny Transcribe AI | $1,800,000 | $300 |

**Savings: $1,796,450 (99.8% reduction)**

---

## 8. Implementation Roadmap

### Phase 1: Infrastructure (Week 1-2)
- [ ] Set up D1 database with video index schema
- [ ] Configure Vectorize index (1024 dimensions, cosine)
- [ ] Set up Analytics Engine for view counts
- [ ] Create sync queue between R2 → D1

### Phase 2: Transcription Pipeline (Week 3-4)
- [ ] Deploy RunPod Whisper endpoint
- [ ] Create job queue for video processing
- [ ] Implement FFmpeg + Whisper pipeline
- [ ] Store transcripts in R2 + index in D1

### Phase 3: Search Integration (Week 5-6)
- [ ] Implement bge-m3 embedding generation
- [ ] Index transcripts in Vectorize
- [ ] Build semantic search API endpoint
- [ ] Add Arabic language support

### Phase 4: Migration (Week 7-8)
- [ ] Migrate existing videos to new pipeline
- [ ] Backfill D1 indexes from R2
- [ ] Generate embeddings for existing transcripts
- [ ] Performance testing and optimization

---

## 9. References

- [Cloudflare Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare Vectorize Docs](https://developers.cloudflare.com/vectorize/)
- [RunPod Pricing](https://www.runpod.io/pricing)
- [RunPod Serverless Docs](https://docs.runpod.io/serverless/pricing)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Bunny.net Transcribe AI](https://bunny.net/stream/)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [BGE-M3 Model](https://huggingface.co/BAAI/bge-m3)
