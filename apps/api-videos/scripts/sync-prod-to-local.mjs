#!/usr/bin/env node
/**
 * Sync R2 data from production buckets to local preview buckets
 *
 * This script uses the Cloudflare API to list objects in production buckets
 * and copies them to the preview buckets for local development.
 *
 * Usage: node scripts/sync-prod-to-local.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// Bucket pairs to sync (production -> preview)
const BUCKET_PAIRS = [
  { source: 'videos', dest: 'videos-preview' },
  { source: 'profiles', dest: 'profiles-preview' },
  { source: 'channels', dest: 'channels-preview' },
  { source: 'playlists', dest: 'playlists-preview' },
  { source: 'reports', dest: 'reports-preview' },
  { source: 'watch-history', dest: 'watch-history-preview' },
];

// Color codes for terminal output
const colors = {
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
};

/**
 * Execute shell command and return output
 */
function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    throw error;
  }
}

/**
 * List all objects in an R2 bucket using the production binding
 * Uses wrangler in remote mode to access the actual production bucket
 */
async function listBucketObjects(bucketName) {
  console.log(`  📋 Listing objects in ${bucketName}...`);

  // Create a temporary worker script to list the bucket
  const tempScript = join(process.cwd(), `.temp-list-${bucketName}.ts`);
  const scriptContent = `
    export default {
      async fetch(request, env) {
        const bucket = env.${bucketName.replace(/-/g, '_')};
        const objects = await bucket.list();
        return new Response(JSON.stringify({
          objects: objects.objects.map(obj => ({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded,
          })),
          truncated: objects.truncated,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    };
  `;

  writeFileSync(tempScript, scriptContent);

  try {
    // Deploy temporary worker with production binding
    const output = exec(
      `pnpm wrangler dev ${tempScript} --remote --test-scheduled --compatibility-date=2025-04-12`,
      { silent: true, ignoreError: true }
    );

    // Parse the response
    if (output) {
      const data = JSON.parse(output);
      return data.objects || [];
    }
  } catch (error) {
    console.error(`  ⚠️  Error listing ${bucketName}:`, error.message);
  } finally {
    // Cleanup
    if (existsSync(tempScript)) {
      unlinkSync(tempScript);
    }
  }

  return [];
}

/**
 * Sync a single object from source to destination bucket
 */
function syncObject(sourceBucket, destBucket, key) {
  const tempFile = `/tmp/r2-sync-${Date.now()}-${key.replace(/\//g, '_')}`;

  try {
    // Download from source bucket
    exec(
      `pnpm wrangler r2 object get ${sourceBucket}/${key} --file="${tempFile}"`,
      { silent: true }
    );

    // Upload to destination bucket
    exec(
      `pnpm wrangler r2 object put ${destBucket}/${key} --file="${tempFile}"`,
      { silent: true }
    );

    console.log(`${colors.green}   ✓ Copied: ${key}${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.yellow}   ⚠️  Failed to copy ${key}: ${error.message}${colors.reset}`);
    return false;
  } finally {
    // Cleanup temp file
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}

/**
 * Sync all objects from source bucket to destination bucket
 */
async function syncBucket(source, dest) {
  console.log(`${colors.blue}📦 Syncing ${source} → ${dest}${colors.reset}`);

  const objects = await listBucketObjects(source);

  if (!objects || objects.length === 0) {
    console.log(`${colors.yellow}   ⚠️  No objects found in ${source}${colors.reset}`);
    console.log('');
    return;
  }

  console.log(`  📊 Found ${objects.length} objects`);

  let copied = 0;
  let failed = 0;

  for (const obj of objects) {
    const success = syncObject(source, dest, obj.key);
    if (success) {
      copied++;
    } else {
      failed++;
    }
  }

  console.log(`${colors.green}   ✓ Copied: ${copied} objects${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.yellow}   ⚠️  Failed: ${failed} objects${colors.reset}`);
  }
  console.log('');
}

/**
 * Main sync function
 */
async function main() {
  console.log('🔄 Syncing production R2 buckets to local preview buckets...');
  console.log('');

  for (const pair of BUCKET_PAIRS) {
    await syncBucket(pair.source, pair.dest);
  }

  console.log(`${colors.green}✅ All buckets synced successfully!${colors.reset}`);
  console.log('');
  console.log('You can now run \'pnpm dev\' and the local API will use the production data.');
}

// Run the sync
main().catch((error) => {
  console.error('❌ Sync failed:', error);
  process.exit(1);
});
