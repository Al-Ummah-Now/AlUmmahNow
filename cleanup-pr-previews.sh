#!/bin/bash
# Script to clean up PR preview deployments from Cloudflare Workers
# This removes preview deployments for closed/merged PRs

# Note: Don't use 'set -e' because arithmetic operations can cause it to exit
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧹 Cleaning up PR preview deployments...${NC}\n"

# Get all merged/closed PRs
echo "Fetching closed PRs..."
CLOSED_PRS=$(gh pr list --state merged --json number --jq '.[].number' | head -20)

if [ -z "$CLOSED_PRS" ]; then
    echo -e "${YELLOW}No closed PRs found.${NC}"
    exit 0
fi

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Store original directory
ORIGINAL_DIR=$(pwd)

# Function to delete a worker
delete_worker() {
    local worker_name=$1
    local app_subdir=$2

    echo -e "  Attempting to delete: ${worker_name}"

    cd "$PROJECT_ROOT/$app_subdir" || {
        echo -e "  ${RED}✗${NC} Failed to change to directory: $PROJECT_ROOT/$app_subdir"
        cd "$ORIGINAL_DIR"
        return 1
    }

    if pnpm wrangler delete "$worker_name" --force 2>&1 | grep -q "successfully deleted\|not found\|does not exist"; then
        echo -e "  ${GREEN}✓${NC} Deleted or already removed: $worker_name"
        cd "$ORIGINAL_DIR"
        return 0
    else
        echo -e "  ${YELLOW}⚠${NC}  Could not delete: $worker_name"
        cd "$ORIGINAL_DIR"
        return 1
    fi
}

# Counter for deletions
DELETED=0
FAILED=0

# Process each closed PR
for pr_num in $CLOSED_PRS; do
    echo -e "\n${YELLOW}Processing PR #${pr_num}...${NC}"

    # Web preview
    WEB_NAME="al-ummah-web-pr-${pr_num}"
    if delete_worker "$WEB_NAME" "apps/web"; then
        DELETED=$((DELETED + 1))
    else
        FAILED=$((FAILED + 1))
    fi

    # API preview
    API_NAME="al-ummah-api-pr-${pr_num}"
    if delete_worker "$API_NAME" "apps/api-videos"; then
        DELETED=$((DELETED + 1))
    else
        FAILED=$((FAILED + 1))
    fi

    # Processor preview
    PROCESSOR_NAME="al-ummah-processor-pr-${pr_num}"
    if delete_worker "$PROCESSOR_NAME" "apps/processor"; then
        DELETED=$((DELETED + 1))
    else
        FAILED=$((FAILED + 1))
    fi
done

# Summary
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Cleanup complete!${NC}"
echo -e "  ${GREEN}Deleted:${NC} $DELETED workers"
if [ $FAILED -gt 0 ]; then
    echo -e "  ${YELLOW}Failed:${NC} $FAILED workers (may not exist)"
fi
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
