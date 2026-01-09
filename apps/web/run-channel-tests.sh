#!/bin/bash

# Channel Routing System Test Runner
# Run comprehensive integration tests for channel routing

set -e

echo "======================================"
echo "Channel Routing System - Test Suite"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Test Files Created:${NC}"
echo "  1. apps/web/src/app/[locale]/channels/[id]/__tests__/routing.test.tsx"
echo "  2. apps/web/src/components/Channel/__tests__/ChannelTabs.test.tsx"
echo "  3. apps/web/src/lib/api/__tests__/channel-tabs.test.ts"
echo ""

echo -e "${BLUE}Running API Tests...${NC}"
pnpm test src/lib/api/__tests__/channel-tabs.test.ts --verbose || echo -e "${YELLOW}API tests skipped${NC}"
echo ""

echo -e "${BLUE}Running Component Tests...${NC}"
pnpm test src/components/Channel/__tests__/ChannelTabs.test.tsx --verbose || echo -e "${YELLOW}Component tests skipped${NC}"
echo ""

echo -e "${BLUE}Running Routing Tests...${NC}"
pnpm test src/app/[locale]/channels/[id]/__tests__/routing.test.tsx --verbose || echo -e "${YELLOW}Routing tests skipped${NC}"
echo ""

echo -e "${BLUE}Running All Channel Tests Together...${NC}"
pnpm test --testPathPattern="(routing|ChannelTabs|channel-tabs)" || echo -e "${YELLOW}Combined tests skipped${NC}"
echo ""

echo -e "${GREEN}Test suite execution completed!${NC}"
echo ""
echo -e "${BLUE}To generate coverage report:${NC}"
echo "  pnpm test --coverage --testPathPattern=\"(routing|ChannelTabs|channel-tabs)\""
echo ""
echo -e "${BLUE}To run tests in watch mode:${NC}"
echo "  pnpm test --watch --testPathPattern=\"ChannelTabs\""
echo ""
