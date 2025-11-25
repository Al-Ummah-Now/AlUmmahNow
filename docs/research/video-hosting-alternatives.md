# Video Hosting Alternatives Research

**Date**: 2025-01-25
**Context**: Evaluating Bunny.net alternatives for 30TB video platform

## Current Setup: Bunny.net

| Feature | Bunny.net |
|---------|-----------|
| Storage | $0.01/GB/month = $300/month for 30TB |
| Bandwidth | $0.01/GB (varies by region) |
| Transcoding | Included |
| Transcribe AI | $0.10/minute (expensive at scale) |
| Audio Extraction | ❌ Not built-in |

## Alternatives Evaluated

### 1. Cloudflare Stream

| Feature | Cloudflare Stream |
|---------|-------------------|
| Storage | $5/1,000 minutes stored |
| Delivery | $1/1,000 minutes delivered |
| Transcoding | Included |
| Audio Track | ✅ Built-in (`/manifest/audio.m3u8`) |
| Captions | ✅ Built-in AI captions |

**Cost for 30TB (~300,000 hours = 18M minutes)**:
- Storage: 18,000 × $5 = $90,000/month ❌ TOO EXPENSIVE
- Better for: Small to medium video libraries

**Audio extraction URL pattern**:
```
https://customer-{hash}.cloudflarestream.com/{videoId}/manifest/audio.m3u8
```

### 2. DynTube

| Feature | DynTube |
|---------|---------|
| Storage | ~73% cheaper than Bunny |
| Bandwidth | Competitive |
| API | REST API available |
| Transcoding | Included |

**Advantages**:
- Significantly cheaper storage
- Good for large video libraries
- API-first design

**Disadvantages**:
- Less documentation than Bunny
- Smaller ecosystem

### 3. Mux

| Feature | Mux |
|---------|-----|
| Encoding | $0.015/minute |
| Storage | $0.0055/minute/month |
| Delivery | $0.00096/minute |
| Audio Track | ✅ Available via API |

**Cost for 30TB (~18M minutes)**:
- Encoding (one-time): 18M × $0.015 = $270,000
- Storage: 18M × $0.0055 = $99,000/month ❌ TOO EXPENSIVE

**Best for**: Professional video platforms needing advanced analytics

### 4. api.video

| Feature | api.video |
|---------|-----------|
| Storage | Tiered pricing |
| Encoding | Included |
| Live Streaming | ✅ Included |
| Analytics | ✅ Built-in |

**Pricing**: Enterprise pricing, not publicly disclosed for 30TB scale

### 5. Vimeo OTT / Enterprise

| Feature | Vimeo |
|---------|-------|
| Storage | Enterprise pricing |
| CDN | Global |
| DRM | ✅ Available |

**Best for**: Monetized video platforms, not cost-effective for UGC

## Cost Comparison for 30TB

| Provider | Monthly Storage | Notes |
|----------|-----------------|-------|
| **Bunny.net** | $300 | Best value, no audio extraction |
| **DynTube** | ~$80-100 | 73% cheaper, less ecosystem |
| **Cloudflare Stream** | $90,000 | Per-minute pricing kills it |
| **Mux** | $99,000 | Enterprise features, expensive |
| **api.video** | TBD | Enterprise pricing |

## Recommendation

**Stay with Bunny.net** for video hosting because:
1. Best price-to-feature ratio at 30TB scale
2. Mature ecosystem and SDK
3. Global CDN performance
4. Good API documentation

**Add separate audio extraction** via:
1. RunPod (FFmpeg + Whisper on same GPU) - $3,400 one-time
2. Or client-side WebAudio API for short videos

## Audio Extraction Approaches

Since Bunny.net doesn't have built-in audio extraction:

### Option A: Server-Side (Recommended for 1-2hr videos)

```
Video URL (Bunny) → RunPod (FFmpeg) → Audio → Whisper → Transcript
```

### Option B: Client-Side (For videos <10 min)

```
Video File → Browser (WebAudio API) → Audio Chunks → Worker → Whisper
```

### Option C: Cloudflare Stream for Audio Only

If switching to Cloudflare Stream just for audio extraction:
- Use Stream's audio track endpoint
- But storage cost is prohibitive at scale

## Decision

| Component | Provider | Cost |
|-----------|----------|------|
| Video Hosting | Bunny.net | $300/month |
| Audio Extraction | RunPod FFmpeg | ~$600 one-time |
| Transcription | RunPod Whisper | ~$3,400 one-time |
| Search Index | Cloudflare Vectorize | $5/month |

**Total: ~$4,000 one-time + $305/month**

---

## References

- [Bunny.net Pricing](https://bunny.net/pricing/)
- [Cloudflare Stream Pricing](https://developers.cloudflare.com/stream/pricing/)
- [Mux Pricing](https://www.mux.com/pricing)
- [DynTube](https://www.dyntube.com/)
- [api.video](https://api.video/)
