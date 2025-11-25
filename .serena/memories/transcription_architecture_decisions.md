# Transcription & AI Search Architecture Decisions

## Key Decisions (2025-01-25)

### Scale: 30TB video platform, 200k videos, 1-2 hours each

### Transcription: RunPod Self-Hosted Whisper
- Cost: ~$3,400 (vs $1.8M for Bunny Transcribe AI)
- RTX 4090 at $0.34/hr, 30x realtime speed
- Run FFmpeg + Whisper on same GPU (no separate extraction cost)

### AI Search: Cloudflare Vectorize + bge-m3
- Model: @cf/baai/bge-m3 (Arabic + English support)
- Dimensions: 1024, metric: cosine
- Index transcripts for semantic search

### Data Architecture: Hybrid
- R2: Source of truth (full objects)
- D1: Queryable indexes (metadata, search)
- Analytics Engine: High-frequency counters (views, likes)
- Vectorize: Semantic search (transcript embeddings)

### Privacy
- Cloudflare: No training on customer data
- RunPod: No training on customer data
- Both GDPR compliant

### Monthly Costs
- Bunny Storage (30TB): $300
- Cloudflare D1: $5
- Cloudflare Vectorize: $5
- Total: ~$310/month

### Full Research Doc
See: docs/research/transcription-and-search-architecture.md
