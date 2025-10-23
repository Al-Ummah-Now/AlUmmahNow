# R2 Bucket Sync Guide

Guide for syncing production R2 buckets to local preview buckets for development.

## ⚠️ Critical Discovery

**Wrangler's local dev mode cannot access cloud R2 buckets!**

When running `pnpm dev` (or `wrangler dev`), R2 bindings operate in "local" mode, which means:
- They point to a local persistence directory on your machine
- They do NOT connect to actual Cloudflare R2 buckets (production or preview)
- The `.list()` API call returns data from local storage, not the cloud

**Verification**:
```bash
# Cloud storage shows data exists:
pnpm wrangler r2 bucket info videos-preview
# Output: object_count: 369, bucket_size: 529 kB

# But local API returns 0 objects:
curl "http://127.0.0.1:8686/internal/sync-r2?action=list" | jq '.buckets[0].objectCount'
# Output: 0
```

This means you **cannot** sync data programmatically through the API in dev mode. You must use external tools like rclone or the Cloudflare Dashboard.

## Current Status ✅

**Good news!** The production data is already synced to preview buckets:

| Bucket | Production Objects/Size | Preview Objects/Size | Status |
|--------|------------------------|---------------------|---------|
| videos | 369 objects / 528 kB | 369 objects / 529 kB | ✅ Synced |
| profiles | 0 objects / 0 B | 0 objects / 0 B | Empty |
| channels | 0 objects / 0 B | 0 objects / 0 B | Empty |
| playlists | 0 objects / 0 B | 0 objects / 0 B | Empty |
| reports | 0 objects / 0 B | 0 objects / 0 B | Empty |
| watch-history | 0 objects / 0 B | 0 objects / 0 B | Empty |

**However**, to access this data in local development, you need to:
1. Use `pnpm wrangler dev --remote` (unstable with 503 errors)
2. Populate the local storage by uploading via the API

Wrangler's local dev mode uses local storage, so the preview bucket data in the cloud is not accessible unless you use remote mode.

## Problem

Wrangler CLI does not provide built-in commands to list or sync R2 objects between buckets.
When running in **local dev mode** (`pnpm dev`), R2 bindings use **local storage**, not cloud buckets.
When running in **remote mode** (`pnpm wrangler dev --remote`), you get 503 Service Temporarily Unavailable errors.

## Solutions

### Option 1: Using Cloudflare Dashboard ❌ (NOT VIABLE)

**Why it doesn't work**:
- R2 dashboard has no bulk download feature
- You can only view and upload individual files
- No copy/sync between buckets functionality

**Conclusion**: This approach is not viable for syncing 369 objects.

### Option 2: Using rclone (ONLY VIABLE OPTION) ⭐⭐⭐

**Pros**: Fast, automated, supports incremental sync
**Cons**: Requires installation and R2 API token configuration

#### Step 1: Install rclone

```bash
# macOS
brew install rclone

# Ubuntu/Debian
sudo apt install rclone

# Or download from https://rclone.org/install/
```

#### Step 2: Get R2 API credentials

1. Go to https://dash.cloudflare.com
2. Navigate to **R2** > **Overview**
3. Click **Manage R2 API Tokens**
4. Create a new API token with **Read & Write** permissions
5. Save the **Access Key ID** and **Secret Access Key**

#### Step 3: Configure rclone for Cloudflare R2

```bash
rclone config
```

Follow the prompts:
1. Choose `n` for New remote
2. Name: `r2-prod` (or any name)
3. Storage: Choose `s3` (Cloudflare R2 uses S3-compatible API)
4. Provider: Choose `Cloudflare`
5. Access Key ID: Paste your R2 Access Key ID
6. Secret Access Key: Paste your R2 Secret Access Key
7. Region: Press enter (not needed for R2)
8. Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - Replace `<ACCOUNT_ID>` with your Cloudflare account ID
   - Get it from: `pnpm wrangler whoami`
9. Complete the configuration

#### Step 4: Sync buckets

```bash
# Sync a single bucket
rclone sync r2-prod:videos r2-prod:videos-preview --progress

# Sync all buckets (create a script)
./scripts/rclone-sync.sh
```

Create `scripts/rclone-sync.sh`:

```bash
#!/bin/bash
# Sync all R2 production buckets to preview buckets

declare -a BUCKETS=(
  "videos"
  "profiles"
  "channels"
  "playlists"
  "reports"
  "watch-history"
)

for bucket in "${BUCKETS[@]}"; do
  echo "🔄 Syncing $bucket → $bucket-preview..."
  rclone sync "r2-prod:$bucket" "r2-prod:$bucket-preview" --progress
  echo "✅ Synced $bucket"
done

echo "✅ All buckets synced successfully!"
```

```bash
chmod +x scripts/rclone-sync.sh
./scripts/rclone-sync.sh
```

### Option 3: Using Custom API Endpoint ⚠️ (NOT RECOMMENDED)

A custom sync endpoint exists at `/internal/sync-r2`, but **it cannot access production data** due to wrangler limitations.

**Why it doesn't work**:
- `wrangler dev` (local mode) uses R2 bindings in "local" mode, which points to local storage, not cloud buckets
- `wrangler dev --remote` still uses preview bindings and is unstable (503 errors)
- There's no way to make wrangler dev bindings point to production R2 buckets

**Verification**:
```bash
# This shows production has data:
pnpm wrangler r2 bucket info videos
# Output: object_count: 369, bucket_size: 528 kB

# But the API endpoint returns 0 objects:
curl "http://127.0.0.1:8686/internal/sync-r2?action=list" | jq '.buckets[] | select(.source == "videos") | .objectCount'
# Output: 0
```

**Conclusion**: This approach is not viable. Use Option 1 (Dashboard) or Option 2 (rclone) instead.

### Option 4: Using Cloudflare API Directly

For advanced users, you can use the R2 API directly with curl or a script.

```bash
# Get list of objects
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket_name}/objects" \
  -H "Authorization: Bearer {api_token}"

# Copy object (requires downloading then uploading)
# 1. Download from source
curl -X GET "https://{account_id}.r2.cloudflarestorage.com/{bucket}/{key}" \
  --aws-sigv4 "aws:amz:us-east-1:s3" \
  -o /tmp/object

# 2. Upload to destination
curl -X PUT "https://{account_id}.r2.cloudflarestorage.com/{dest-bucket}/{key}" \
  --aws-sigv4 "aws:amz:us-east-1:s3" \
  --upload-file /tmp/object
```

## Recommendation

For one-time sync or small datasets: **Use Cloudflare Dashboard (Option 1)**
For regular syncing or large datasets: **Use rclone (Option 2)**
For automation in CI/CD: **Use rclone with API tokens**

## Troubleshooting

### "No objects found" when using API endpoint

This means you're running in **local dev mode** which uses **preview bindings**.
The production data is in the production buckets, not the preview buckets.
Solution: Use Option 1 or 2 instead.

### "503 Service Temporarily Unavailable" in remote mode

Cloudflare's remote mode is unstable for some accounts.
Solution: Use Option 1 or 2 instead.

### rclone errors

1. Verify your Account ID: `pnpm wrangler whoami`
2. Verify your R2 API token has Read & Write permissions
3. Check the endpoint URL format: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
4. Test with: `rclone lsd r2-prod:` (should list all buckets)

## After Syncing

Once you've synced the data, restart your local API server:

```bash
cd /home/meywd/AlUmmahNow/apps/api-videos
pnpm dev
```

The local API will now use the production data in the preview buckets.

## References

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [rclone Documentation](https://rclone.org/docs/)
- [Cloudflare R2 API](https://developers.cloudflare.com/api/operations/r2-list-objects)
