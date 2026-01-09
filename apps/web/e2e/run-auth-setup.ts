#!/usr/bin/env npx tsx
/**
 * Standalone script to run auth setup independently.
 *
 * This is used in CI to run auth setup once in a dedicated job,
 * then share the auth state files with parallel test jobs via artifacts.
 *
 * Usage:
 *   npx tsx e2e/run-auth-setup.ts
 *
 * Required environment variables:
 *   - RESEND_API_KEY: Resend API key for email verification
 *   - OPENAUTH_URL: OpenAuth server URL (default: http://localhost:3301)
 *   - WEB_APP_URL: Web app URL (default: http://localhost:3001)
 */

import type { FullConfig } from '@playwright/test';
import globalSetup from './auth.setup';

async function main() {
  console.log('='.repeat(60));
  console.log('Running standalone auth setup...');
  console.log('='.repeat(60));

  try {
    // Run globalSetup with minimal config (it doesn't use most of the config)
    // Cast to FullConfig since we only need the basic structure
    const minimalConfig = {
      configFile: '',
      rootDir: process.cwd(),
    } as FullConfig;

    await globalSetup(minimalConfig);

    console.log('='.repeat(60));
    console.log('Auth setup completed successfully!');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('='.repeat(60));
    console.error('Auth setup failed:', error);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

main();
