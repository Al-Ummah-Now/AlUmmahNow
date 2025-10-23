#!/bin/bash
# Sync R2 data from production buckets to local preview buckets
# This script temporarily modifies wrangler.jsonc to access production buckets

set -e

echo "🔄 Syncing production R2 buckets to local preview buckets..."
echo ""

# Change to API directory
cd /home/meywd/AlUmmahNow/apps/api-videos

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Backup wrangler config
WRANGLER_CONFIG="wrangler.jsonc"
BACKUP_CONFIG="wrangler.jsonc.backup"

echo "📋 Backing up wrangler configuration..."
cp "$WRANGLER_CONFIG" "$BACKUP_CONFIG"

# Function to restore config on exit
restore_config() {
  echo ""
  echo "🔄 Restoring wrangler configuration..."
  mv "$BACKUP_CONFIG" "$WRANGLER_CONFIG"
  echo -e "${GREEN}✅ Configuration restored${NC}"
}

# Set trap to restore config on exit (success or failure)
trap restore_config EXIT

# Modify wrangler.jsonc to use production buckets in preview mode
# This swaps preview_bucket_name to point to production buckets temporarily
echo "⚙️  Temporarily modifying config to access production buckets..."
cat "$WRANGLER_CONFIG" | \
  sed 's/"preview_bucket_name": "videos-preview"/"preview_bucket_name": "videos"/g' | \
  sed 's/"preview_bucket_name": "profiles-preview"/"preview_bucket_name": "profiles"/g' | \
  sed 's/"preview_bucket_name": "channels-preview"/"preview_bucket_name": "channels"/g' | \
  sed 's/"preview_bucket_name": "playlists-preview"/"preview_bucket_name": "playlists"/g' | \
  sed 's/"preview_bucket_name": "reports-preview"/"preview_bucket_name": "reports"/g' | \
  sed 's/"preview_bucket_name": "watch-history-preview"/"preview_bucket_name": "watch-history"/g' \
  > "$WRANGLER_CONFIG.tmp"
mv "$WRANGLER_CONFIG.tmp" "$WRANGLER_CONFIG"

echo -e "${GREEN}✅ Configuration modified${NC}"
echo ""

# Kill any existing wrangler processes
echo "🛑 Stopping any existing API instances..."
pkill -f "wrangler dev" || true
sleep 2

# Start API in local mode (which now uses production buckets via modified config)
echo "🚀 Starting API with production bucket access..."
pnpm wrangler dev > /tmp/wrangler-prod-sync.log 2>&1 &
WRANGLER_PID=$!

# Wait for API to be ready
API_URL="http://127.0.0.1:8686"
echo "⏳ Waiting for API to be ready..."
for i in {1..60}; do
  if curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API is ready!${NC}"
    echo ""
    break
  fi
  if [ $i -eq 60 ]; then
    echo -e "${RED}❌ API failed to start after 60 seconds${NC}"
    echo "Check logs at: /tmp/wrangler-prod-sync.log"
    kill $WRANGLER_PID || true
    exit 1
  fi
  sleep 1
done

# Get list of production buckets and their objects
echo "📋 Fetching production bucket data..."
BUCKET_DATA=$(curl -s "$API_URL/internal/sync-r2?action=list")

# Check if we got valid data
if ! echo "$BUCKET_DATA" | jq -e '.success' > /dev/null 2>&1; then
  echo -e "${RED}❌ Failed to fetch bucket data${NC}"
  echo "Response: $BUCKET_DATA"
  kill $WRANGLER_PID || true
  exit 1
fi

echo -e "${GREEN}✅ Successfully fetched bucket data${NC}"
echo ""

# Stop API with production access
echo "🛑 Stopping API with production access..."
kill $WRANGLER_PID || true
sleep 2

# Restore configuration (trap will handle this, but do it now to be safe)
mv "$BACKUP_CONFIG" "$WRANGLER_CONFIG"
echo -e "${GREEN}✅ Configuration restored${NC}"
echo ""

# Parse bucket data
BUCKETS=($(echo "$BUCKET_DATA" | jq -r '.buckets[] | @base64'))

TOTAL_COPIED=0
TOTAL_FAILED=0

# Now sync each bucket using wrangler R2 commands
for bucket_base64 in "${BUCKETS[@]}"; do
  # Decode bucket data
  BUCKET_JSON=$(echo "$bucket_base64" | base64 --decode)

  SOURCE=$(echo "$BUCKET_JSON" | jq -r '.source')
  DEST=$(echo "$BUCKET_JSON" | jq -r '.dest')
  OBJECT_COUNT=$(echo "$BUCKET_JSON" | jq -r '.objectCount')

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}📦 Syncing: ${SOURCE} → ${DEST}${NC}"
  echo -e "${BLUE}   Objects to copy: ${OBJECT_COUNT}${NC}"
  echo ""

  if [ "$OBJECT_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}   ⚠️  No objects to copy${NC}"
    echo ""
    continue
  fi

  # Get objects list
  OBJECTS=$(echo "$BUCKET_JSON" | jq -r '.objects[]?.key // empty')

  if [ -z "$OBJECTS" ]; then
    echo -e "${YELLOW}   ⚠️  No objects found${NC}"
    echo ""
    continue
  fi

  COPIED=0
  FAILED=0

  # Copy each object
  while IFS= read -r key; do
    if [ -z "$key" ]; then
      continue
    fi

    TEMP_FILE="/tmp/r2-sync-$(date +%s)-$(echo "$key" | sed 's/[^a-zA-Z0-9]/_/g')"

    # Download from source bucket
    if pnpm wrangler r2 object get "${SOURCE}/${key}" --file="${TEMP_FILE}" > /dev/null 2>&1; then
      # Upload to destination bucket
      if pnpm wrangler r2 object put "${DEST}/${key}" --file="${TEMP_FILE}" > /dev/null 2>&1; then
        echo -e "${GREEN}   ✓ ${key}${NC}"
        COPIED=$((COPIED + 1))
      else
        echo -e "${RED}   ✗ Failed to upload: ${key}${NC}"
        FAILED=$((FAILED + 1))
      fi
    else
      echo -e "${RED}   ✗ Failed to download: ${key}${NC}"
      FAILED=$((FAILED + 1))
    fi

    # Cleanup temp file
    rm -f "${TEMP_FILE}"

  done <<< "$OBJECTS"

  echo ""
  echo -e "${GREEN}   ✅ Copied: ${COPIED} objects${NC}"
  if [ $FAILED -gt 0 ]; then
    echo -e "${RED}   ❌ Failed: ${FAILED} objects${NC}"
  fi
  echo ""

  TOTAL_COPIED=$((TOTAL_COPIED + COPIED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}✅ Sync complete!${NC}"
echo -e "${GREEN}   Total copied: ${TOTAL_COPIED} objects${NC}"
if [ $TOTAL_FAILED -gt 0 ]; then
  echo -e "${RED}   Total failed: ${TOTAL_FAILED} objects${NC}"
fi
echo ""

echo "🎉 You can now use the local API with production data!"
echo "Start the API in local mode with: cd /home/meywd/AlUmmahNow/apps/api-videos && pnpm dev"
