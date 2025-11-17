import { test as base } from '@playwright/test';

/**
 * Test fixtures for Al Ummah Now E2E tests
 * Provides reusable setup and utilities across tests
 */

type TestFixtures = Record<string, never>;

export const test = base.extend<TestFixtures>({
  // Custom fixtures go here
});

export { expect } from '@playwright/test';
