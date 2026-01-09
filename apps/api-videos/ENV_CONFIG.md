# API Environment Configuration

This document explains how environment variables and secrets are configured for the Al-Ummah Now Videos API.

## Local Development

When running `pnpm dev` (which runs `wrangler dev`), secrets and environment variables are loaded from two files:

### 1. `.dev.vars` (Secrets)
**Purpose**: Store sensitive API keys and secrets for local development
**Location**: `apps/api-videos/.dev.vars`
**Git Status**: **Ignored** (never commit)

**Contents**:
```bash
# Bunny.net Image Storage API Key
image_storage_key=YOUR_KEY_HERE

# Bunny.net Stream API Key
bunny-stream-key=YOUR_KEY_HERE

# Bunny.net Stream Library ID
bunny_stream_library_id=YOUR_ID_HERE
```

### 2. `wrangler.jsonc` (Environment Variables)
**Purpose**: Non-sensitive configuration
**Location**: `apps/api-videos/wrangler.jsonc`
**Git Status**: **Committed** (part of repository)

**Contents** (in `vars` section):
```jsonc
"vars": {
  "ZONE": "al-ummah-now-images",
  "ClientId": "web",
  "Issuer": "http://localhost:3301",
  "Audience": "http://127.0.0.1:3086"
}
```

## How Secrets Work

### In Local Development (`wrangler dev`)
Secrets from `.dev.vars` are available as **string values** in `c.env`:

```typescript
// Accessing in code
const key = c.env.image_storage_key; // Returns string directly
```

### In Production (Cloudflare Workers)
Secrets are stored in Cloudflare Secrets Store and accessed as **bindings**:

```typescript
// Accessing in code
const key = await c.env.image_storage_key.get(); // Returns promise
```

### Unified Access Pattern (Works in Both)
The endpoints use this pattern to work in both environments:

```typescript
const key = c.env.image_storage_key
    ? (typeof c.env.image_storage_key === 'string'
        ? c.env.image_storage_key  // Local dev (.dev.vars)
        : await c.env.image_storage_key.get())  // Production (Secrets Store)
    : '';
```

## Cloudflare Bindings

These are automatically configured by Wrangler and don't need environment files:

### R2 Buckets
- `c.env.videos` - Video objects
- `c.env.profiles` - User profiles
- `c.env.channels` - Channel data
- `c.env.playlists` - Playlist data
- `c.env.reports` - Moderation reports
- `c.env.watch_history` - Watch history tracking

### KV Namespaces
- `c.env.TUS_SESSIONS` - Resumable upload sessions
- `c.env.RATE_LIMIT_KV` - Rate limiting

### Queues
- `c.env.queue` - Message queue (al-ummah-now-videos)

## Production Deployment

For production, secrets are managed via Cloudflare dashboard or CLI:

```bash
# Set production secret
npx wrangler secret put image_storage_key

# List secrets
npx wrangler secret list
```

Environment variables in `wrangler.jsonc` `vars` section are automatically deployed.

## Quick Reference

| File | Purpose | Git | Used By |
|------|---------|-----|---------|
| `.dev.vars` | Local secrets | ❌ Ignored | `wrangler dev` |
| `.env.local` | Backup/reference | ❌ Ignored | Not used directly |
| `.env` | Developer reference | ❌ Ignored | Not used |
| `wrangler.jsonc` | Config & vars | ✅ Committed | All environments |

## Troubleshooting

### "Storage configuration missing" error
1. Check `.dev.vars` exists with correct values
2. Restart `wrangler dev` to reload secrets
3. Verify `image_storage_key` is set correctly

### "Cannot read from env"
- Use `c.env.VARIABLE_NAME` not `env.VARIABLE_NAME`
- Ensure wrangler.jsonc has correct bindings

### Secrets not loading
- Delete `.wrangler/` folder: `rm -rf .wrangler/`
- Restart dev server: `pnpm dev`
