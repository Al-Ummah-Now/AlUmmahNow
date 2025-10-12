#!/bin/bash
# Simple script to delete PR preview workers one by one

# PR #41 (MERGED)
echo "Deleting PR #41 workers..."
npx wrangler delete --name al-ummah-web-pr-41 --force || echo "  Failed or not found: al-ummah-web-pr-41"
npx wrangler delete --name al-ummah-api-pr-41 --force || echo "  Failed or not found: al-ummah-api-pr-41"
npx wrangler delete --name al-ummah-processor-pr-41 --force || echo "  Failed or not found: al-ummah-processor-pr-41"

# PR #25 (MERGED)
echo "Deleting PR #25 workers..."
npx wrangler delete --name al-ummah-web-pr-25 --force || echo "  Failed or not found: al-ummah-web-pr-25"
npx wrangler delete --name al-ummah-api-pr-25 --force || echo "  Failed or not found: al-ummah-api-pr-25"
npx wrangler delete --name al-ummah-processor-pr-25 --force || echo "  Failed or not found: al-ummah-processor-pr-25"

# PR #22 (MERGED)
echo "Deleting PR #22 workers..."
npx wrangler delete --name al-ummah-web-pr-22 --force || echo "  Failed or not found: al-ummah-web-pr-22"
npx wrangler delete --name al-ummah-api-pr-22 --force || echo "  Failed or not found: al-ummah-api-pr-22"
npx wrangler delete --name al-ummah-processor-pr-22 --force || echo "  Failed or not found: al-ummah-processor-pr-22"

# PR #21 (MERGED)
echo "Deleting PR #21 workers..."
npx wrangler delete --name al-ummah-web-pr-21 --force || echo "  Failed or not found: al-ummah-web-pr-21"
npx wrangler delete --name al-ummah-api-pr-21 --force || echo "  Failed or not found: al-ummah-api-pr-21"
npx wrangler delete --name al-ummah-processor-pr-21 --force || echo "  Failed or not found: al-ummah-processor-pr-21"

# PR #20 (MERGED)
echo "Deleting PR #20 workers..."
npx wrangler delete --name al-ummah-web-pr-20 --force || echo "  Failed or not found: al-ummah-web-pr-20"
npx wrangler delete --name al-ummah-api-pr-20 --force || echo "  Failed or not found: al-ummah-api-pr-20"
npx wrangler delete --name al-ummah-processor-pr-20 --force || echo "  Failed or not found: al-ummah-processor-pr-20"

# PR #19 (MERGED)
echo "Deleting PR #19 workers..."
npx wrangler delete --name al-ummah-web-pr-19 --force || echo "  Failed or not found: al-ummah-web-pr-19"
npx wrangler delete --name al-ummah-api-pr-19 --force || echo "  Failed or not found: al-ummah-api-pr-19"
npx wrangler delete --name al-ummah-processor-pr-19 --force || echo "  Failed or not found: al-ummah-processor-pr-19"

# PR #18 (MERGED)
echo "Deleting PR #18 workers..."
npx wrangler delete --name al-ummah-web-pr-18 --force || echo "  Failed or not found: al-ummah-web-pr-18"
npx wrangler delete --name al-ummah-api-pr-18 --force || echo "  Failed or not found: al-ummah-api-pr-18"
npx wrangler delete --name al-ummah-processor-pr-18 --force || echo "  Failed or not found: al-ummah-processor-pr-18"

# PR #16 (MERGED)
echo "Deleting PR #16 workers..."
npx wrangler delete --name al-ummah-web-pr-16 --force || echo "  Failed or not found: al-ummah-web-pr-16"
npx wrangler delete --name al-ummah-api-pr-16 --force || echo "  Failed or not found: al-ummah-api-pr-16"
npx wrangler delete --name al-ummah-processor-pr-16 --force || echo "  Failed or not found: al-ummah-processor-pr-16"

echo "✓ Cleanup complete!"
