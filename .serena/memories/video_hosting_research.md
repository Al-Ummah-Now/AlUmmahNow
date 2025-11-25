# Video Hosting Research (2025-01-25)

## Scale: 30TB, 200k videos

## Decision: Stay with Bunny.net

### Why Bunny.net
- Storage: $0.01/GB = $300/month for 30TB
- Best price-to-feature ratio
- Mature ecosystem, good SDK
- Global CDN

### Alternatives Rejected

| Provider | 30TB Monthly Cost | Why Rejected |
|----------|-------------------|--------------|
| Cloudflare Stream | $90,000 | Per-minute pricing |
| Mux | $99,000 | Enterprise pricing |
| DynTube | ~$80-100 | Less ecosystem (but viable) |

### Missing from Bunny
- No audio extraction built-in
- Transcribe AI too expensive ($0.10/min)

### Solution
Use RunPod for:
- FFmpeg audio extraction: ~$600 one-time
- Whisper transcription: ~$3,400 one-time

## Full Research
See: docs/research/video-hosting-alternatives.md
