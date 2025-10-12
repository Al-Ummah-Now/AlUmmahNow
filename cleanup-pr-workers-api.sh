#!/bin/bash
# Script to clean up PR preview deployments using Cloudflare API
# This removes preview deployments for closed/merged PRs

set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧹 Cleaning up PR preview deployments using Cloudflare API...${NC}\n"

# Cloudflare Account ID
ACCOUNT_ID="0e4b6e7f9faf280c3c9bf95995edc64f"

# Get API token from wrangler config
echo "Getting Cloudflare API credentials..."
if command -v wrangler &> /dev/null; then
    # Try to get token from wrangler whoami
    API_TOKEN=$(npx wrangler whoami 2>&1 | grep -oP '(?<=API Token: ).*' || echo "")

    if [ -z "$API_TOKEN" ]; then
        echo -e "${RED}✗ Could not get API token from wrangler${NC}"
        echo "Please set CLOUDFLARE_API_TOKEN environment variable"
        exit 1
    fi
else
    if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
        echo -e "${RED}✗ CLOUDFLARE_API_TOKEN environment variable not set${NC}"
        exit 1
    fi
    API_TOKEN="$CLOUDFLARE_API_TOKEN"
fi

# Get all merged/closed PRs
echo "Fetching closed PRs..."
CLOSED_PRS=$(gh pr list --state merged --json number --jq '.[].number' | head -20)

if [ -z "$CLOSED_PRS" ]; then
    echo -e "${YELLOW}No closed PRs found.${NC}"
    exit 0
fi

# Function to delete a worker via API
delete_worker_api() {
    local worker_name=$1

    echo -e "  ${BLUE}→${NC} Attempting to delete: ${worker_name}"

    # Delete worker using Cloudflare API
    response=$(curl -s -X DELETE \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${worker_name}" \
        -H "Authorization: Bearer ${API_TOKEN}" \
        -H "Content-Type: application/json")

    # Check if deletion was successful
    if echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Successfully deleted: ${worker_name}"
        return 0
    else
        # Check if worker doesn't exist
        error_code=$(echo "$response" | jq -r '.errors[0].code // empty' 2>/dev/null)
        error_message=$(echo "$response" | jq -r '.errors[0].message // empty' 2>/dev/null)

        if [ "$error_code" = "10007" ] || [ "$error_code" = "10090" ]; then
            echo -e "  ${YELLOW}⚠${NC}  Worker doesn't exist: ${worker_name}"
            return 2
        else
            echo -e "  ${RED}✗${NC} Failed to delete: ${worker_name}"
            [ -n "$error_message" ] && echo -e "     Error: ${error_message}"
            return 1
        fi
    fi
}

# Counter for deletions
DELETED=0
NOT_FOUND=0
FAILED=0

# Process each closed PR
for pr_num in $CLOSED_PRS; do
    echo -e "\n${YELLOW}Processing PR #${pr_num}...${NC}"

    # Web preview
    WEB_NAME="al-ummah-web-pr-${pr_num}"
    delete_worker_api "$WEB_NAME"
    result=$?
    if [ $result -eq 0 ]; then
        DELETED=$((DELETED + 1))
    elif [ $result -eq 2 ]; then
        NOT_FOUND=$((NOT_FOUND + 1))
    else
        FAILED=$((FAILED + 1))
    fi

    # API preview
    API_NAME="al-ummah-api-pr-${pr_num}"
    delete_worker_api "$API_NAME"
    result=$?
    if [ $result -eq 0 ]; then
        DELETED=$((DELETED + 1))
    elif [ $result -eq 2 ]; then
        NOT_FOUND=$((NOT_FOUND + 1))
    else
        FAILED=$((FAILED + 1))
    fi

    # Processor preview
    PROCESSOR_NAME="al-ummah-processor-pr-${pr_num}"
    delete_worker_api "$PROCESSOR_NAME"
    result=$?
    if [ $result -eq 0 ]; then
        DELETED=$((DELETED + 1))
    elif [ $result -eq 2 ]; then
        NOT_FOUND=$((NOT_FOUND + 1))
    else
        FAILED=$((FAILED + 1))
    fi
done

# Summary
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Cleanup complete!${NC}"
echo -e "  ${GREEN}Deleted:${NC} $DELETED workers"
if [ $NOT_FOUND -gt 0 ]; then
    echo -e "  ${YELLOW}Not Found:${NC} $NOT_FOUND workers (already deleted)"
fi
if [ $FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed:${NC} $FAILED workers"
fi
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Exit with error if any deletions failed
if [ $FAILED -gt 0 ]; then
    exit 1
fi
