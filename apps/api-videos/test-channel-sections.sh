#!/bin/bash

# Test script for Channel Sections API
# Run this script to test all channel section endpoints

BASE_URL="http://127.0.0.1:3086"
CHANNEL_ID="e6367c19-a759-423e-be12-b52b098bce38"

echo "========================================"
echo "   Channel Sections API Test Suite"
echo "========================================"
echo ""
echo "Testing with channel: ${CHANNEL_ID}"
echo "Base URL: ${BASE_URL}"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to print test results
print_test() {
    local test_name="$1"
    local response="$2"
    local success=$(echo "$response" | jq -r '.success // false')

    if [ "$success" = "true" ]; then
        echo -e "${GREEN}✓${NC} $test_name"
        echo "$response" | jq '.'
    else
        echo -e "${RED}✗${NC} $test_name"
        echo "$response" | jq '.'
    fi
    echo ""
}

# ==============================================================================
# PUBLIC ENDPOINTS (No Auth Required)
# ==============================================================================

echo -e "${YELLOW}=== PUBLIC ENDPOINTS (No Auth Required) ===${NC}"
echo ""

# 1. LIST SECTIONS
echo "1. LIST ALL SECTIONS"
response=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections")
print_test "GET /api/channels/{channelId}/sections" "$response"

# Get first section ID for testing
SECTION_ID=$(echo "$response" | jq -r '.result.sections[0].id // empty')

if [ -n "$SECTION_ID" ]; then
    # 2. FETCH SINGLE SECTION
    echo "2. FETCH SINGLE SECTION"
    response=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections/${SECTION_ID}")
    print_test "GET /api/channels/{channelId}/sections/{sectionId}" "$response"
fi

# 3. LIST WITH FILTERS
echo "3. LIST SECTIONS WITH FILTERS"
echo "   a. Filter by type='popular_uploads'"
response=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections?type=popular_uploads")
print_test "GET with type filter" "$response"

echo "   b. Pagination (limit=1)"
response=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections?limit=1")
print_test "GET with pagination" "$response"

# ==============================================================================
# AUTHENTICATED ENDPOINTS (Auth Required)
# ==============================================================================

echo -e "${YELLOW}=== AUTHENTICATED ENDPOINTS (Auth Required) ===${NC}"
echo -e "${RED}Note: These will fail without valid JWT token${NC}"
echo ""

# For testing purposes, use a dummy token
# In production, get this from OpenAuth login
JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5Y2M1N2E1M2M5OTdiMDMwOGVkMzE1OTZkOWI1ZWEzYSIsImVtYWlsIjoibWV5d2RAbXNuLmNvbSIsImlhdCI6MTczMjI0NzY3MCwiZXhwIjoxNzMyODUyNDcwfQ.test"

# 4. CREATE SECTIONS
echo "4. CREATE SECTIONS (Different Types)"

echo "   a. Create 'featured_videos' section (requires videoIds)"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured Videos",
    "titleLocalized": {
      "en": "Featured Videos",
      "ar": "الفيديوهات المميزة"
    },
    "style": "horizontal_row",
    "videoIds": ["video-1", "video-2", "video-3"],
    "itemCount": 6,
    "showTimestamp": true
  }')
print_test "POST featured_videos section" "$response"

echo "   b. Create 'recent_uploads' section (auto-populated)"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_uploads",
    "title": "Recent Uploads",
    "titleLocalized": {
      "en": "Recent Uploads",
      "ar": "التحميلات الأخيرة"
    },
    "style": "horizontal_row",
    "itemCount": 12
  }')
print_test "POST recent_uploads section" "$response"

echo "   c. Create 'single_playlist' section (requires playlistId)"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "single_playlist",
    "title": "Islamic Lectures",
    "playlistId": "playlist-123",
    "style": "horizontal_row",
    "itemCount": 8
  }')
print_test "POST single_playlist section" "$response"

echo "   d. Create 'multiple_playlists' section (requires playlistIds)"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "multiple_playlists",
    "title": "Playlists",
    "playlistIds": ["playlist-1", "playlist-2", "playlist-3"],
    "style": "vertical_list"
  }')
print_test "POST multiple_playlists section" "$response"

# 5. UPDATE SECTION
if [ -n "$SECTION_ID" ]; then
    echo "5. UPDATE SECTION"
    response=$(curl -s -X PUT "${BASE_URL}/api/channels/${CHANNEL_ID}/sections/${SECTION_ID}" \
      -H "Authorization: Bearer ${JWT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{
        "title": "Updated Title",
        "titleLocalized": {
          "en": "Updated Title",
          "ar": "العنوان المحدث"
        },
        "itemCount": 15,
        "showTimestamp": false
      }')
    print_test "PUT /api/channels/{channelId}/sections/{sectionId}" "$response"
fi

# 6. REORDER SECTIONS
echo "6. REORDER SECTIONS"
# First get all section IDs
all_sections=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections")
section_ids=$(echo "$all_sections" | jq -r '.result.sections[].id' | jq -R -s -c 'split("\n") | map(select(length > 0))')

if [ "$section_ids" != "[]" ]; then
    # Reverse the order for testing
    reversed_ids=$(echo "$section_ids" | jq 'reverse')
    response=$(curl -s -X PATCH "${BASE_URL}/api/channels/${CHANNEL_ID}/sections/reorder" \
      -H "Authorization: Bearer ${JWT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"sectionIds\": $reversed_ids}")
    print_test "PATCH /api/channels/{channelId}/sections/reorder" "$response"
fi

# 7. DELETE SECTION
if [ -n "$SECTION_ID" ]; then
    echo "7. DELETE SECTION"
    response=$(curl -s -X DELETE "${BASE_URL}/api/channels/${CHANNEL_ID}/sections/${SECTION_ID}" \
      -H "Authorization: Bearer ${JWT_TOKEN}")
    print_test "DELETE /api/channels/{channelId}/sections/{sectionId}" "$response"
fi

# ==============================================================================
# ERROR CASES
# ==============================================================================

echo -e "${YELLOW}=== ERROR CASES ===${NC}"
echo ""

echo "8. VALIDATION ERRORS"

echo "   a. Invalid section type"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invalid_type",
    "title": "Invalid"
  }')
print_test "POST with invalid type" "$response"

echo "   b. Missing required videoIds for featured_videos"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured"
  }')
print_test "POST featured_videos without videoIds" "$response"

echo "   c. Auto-populated type with videoIds (should fail)"
response=$(curl -s -X POST "${BASE_URL}/api/channels/${CHANNEL_ID}/sections" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent_uploads",
    "title": "Recent",
    "videoIds": ["video-1"]
  }')
print_test "POST recent_uploads with videoIds" "$response"

echo "9. NON-EXISTENT RESOURCES"

echo "   a. Non-existent channel"
response=$(curl -s "${BASE_URL}/api/channels/non-existent-channel/sections")
print_test "GET sections for non-existent channel" "$response"

echo "   b. Non-existent section"
response=$(curl -s "${BASE_URL}/api/channels/${CHANNEL_ID}/sections/non-existent-section")
print_test "GET non-existent section" "$response"

# ==============================================================================
# SUMMARY
# ==============================================================================

echo ""
echo -e "${YELLOW}========================================"
echo "   Test Summary"
echo "========================================${NC}"
echo ""
echo "Channel Sections API Features:"
echo "✓ Public endpoints for listing/fetching sections"
echo "✓ Authentication required for create/update/delete"
echo "✓ Multiple section types with different content requirements"
echo "✓ Auto-populated sections (recent_uploads, popular_uploads, etc.)"
echo "✓ Manual content sections (featured_videos, playlists)"
echo "✓ Section reordering with atomic operation"
echo "✓ Automatic position management on delete"
echo "✓ Localized titles support"
echo "✓ Pagination and filtering"
echo ""
echo "Section Types:"
echo "1. featured_videos - Manually selected videos (requires videoIds)"
echo "2. recent_uploads - Auto-populated with latest videos"
echo "3. popular_uploads - Auto-populated with most viewed videos"
echo "4. single_playlist - Single playlist display (requires playlistId)"
echo "5. multiple_playlists - Multiple playlists (requires playlistIds)"
echo "6. subscribed_channels - Auto-populated with subscribed channels"
echo "7. liked_videos - Auto-populated with liked videos"
echo ""
echo -e "${GREEN}Test script completed!${NC}"