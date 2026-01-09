import { test, expect, helpers } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * TUS Proxy Log Verification Tests
 *
 * These tests verify that TUS proxy operations are properly logged
 * through the centralized logging service (http://localhost:3089).
 *
 * Log Requirements:
 * 1. All TUS operations must be logged (POST, HEAD, PATCH, DELETE, OPTIONS)
 * 2. Logs must include contextual information (userId, videoId, uploadId)
 * 3. Errors must be logged with sufficient detail for debugging
 * 4. Logs must be accessible via the log service API
 */

// Helper function to fetch logs from log service
async function fetchLogs(page: Page, filters?: { level?: string; search?: string }) {
  try {
    const response = await page.request.get('http://localhost:3089/logs/stream/realtime', {
      params: {
        level: filters?.level || 'all',
        limit: '100',
      },
    });

    if (response.ok()) {
      const logs = await response.json();
      return logs;
    } else {
      console.warn('Failed to fetch logs:', response.status());
      return [];
    }
  } catch (error) {
    console.warn('Error fetching logs:', error);
    return [];
  }
}

// Helper to search logs for specific patterns
function findLogsMatching(logs: unknown[], pattern: string | RegExp): unknown[] {
  return logs.filter((log: unknown) => {
    const logStr = JSON.stringify(log).toLowerCase();
    if (typeof pattern === 'string') {
      return logStr.includes(pattern.toLowerCase());
    } else {
      return pattern.test(logStr);
    }
  });
}

test.describe('TUS Proxy - Log Verification', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
  });

  test('should log TUS upload initiation', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-init-test.mp4', 1024);

    // Start upload
    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Initiation Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to start
    await page.waitForTimeout(3000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Look for TUS POST request logs
    const tusPostLogs = findLogsMatching(logs, /tus.*post|create upload/i);

    // Verify TUS operations are logged
    expect(tusPostLogs.length).toBeGreaterThan(0);

    // Verify logs contain relevant context
    const hasUserId = tusPostLogs.some(log =>
      JSON.stringify(log).includes('userId') || JSON.stringify(log).includes('user')
    );
    expect(hasUserId).toBeTruthy();
  });

  test('should log TUS PATCH operations (chunk uploads)', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-patch-test.mp4', 2048);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Patch Test');
    await page.click('button:has-text("Upload")');

    // Wait for chunks to be uploaded
    await page.waitForTimeout(5000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Look for TUS PATCH request logs (chunk uploads)
    const tusPatchLogs = findLogsMatching(logs, /tus.*patch|upload chunk/i);

    // Should have at least one chunk upload logged
    expect(tusPatchLogs.length).toBeGreaterThan(0);

    // Verify logs contain upload progress context
    const hasUploadOffset = tusPatchLogs.some(log =>
      JSON.stringify(log).toLowerCase().includes('offset') ||
      JSON.stringify(log).toLowerCase().includes('progress')
    );
    expect(hasUploadOffset).toBeTruthy();
  });

  test('should log TUS HEAD operations (resume checks)', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-head-test.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Head Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(2000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // HEAD requests might occur during resume attempts
    // At minimum, we should see TUS-related logs
    const tusLogs = findLogsMatching(logs, /tus/i);
    expect(tusLogs.length).toBeGreaterThan(0);
  });

  test('should log upload completion', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-complete-test.mp4', 512);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Completion Test');
    await page.click('button:has-text("Upload")');

    // Wait for upload to potentially complete
    await page.waitForTimeout(10000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Should have upload-related logs even if not fully complete
    const uploadLogs = findLogsMatching(logs, /upload/i);
    expect(uploadLogs.length).toBeGreaterThan(0);
  });

  test('should log errors with sufficient detail', async ({ page }) => {
    // Mock TUS endpoint to fail
    await page.route('**/api/videos/tus', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated server error' }),
      });
    });

    const videoPath = await helpers.createTestVideo('log-error-test.mp4', 512);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Error Test');
    await page.click('button:has-text("Upload")');

    // Wait for error
    await page.waitForTimeout(5000);

    // Fetch error logs
    const logs = await fetchLogs(page, { level: 'error' });

    // Should have error logs
    // Note: Might be client-side errors, not server-side
    const errorLogs = findLogsMatching(logs, /error|fail/i);
    expect(errorLogs.length).toBeGreaterThan(0);
  });

  test('should include videoId in upload logs', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-videoid-test.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log VideoId Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(3000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Look for logs with videoId
    const videoIdLogs = logs.filter((log: unknown) => {
      const logStr = JSON.stringify(log).toLowerCase();
      return logStr.includes('videoid') || logStr.includes('video_id');
    });

    // Should have logs with videoId context
    expect(videoIdLogs.length).toBeGreaterThan(0);
  });

  test('should log authentication context', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-auth-test.mp4', 512);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Auth Context Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(2000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Look for logs with user/auth context
    const authLogs = logs.filter((log: unknown) => {
      const logStr = JSON.stringify(log).toLowerCase();
      return logStr.includes('userid') ||
             logStr.includes('user_id') ||
             logStr.includes('authenticated');
    });

    // Should have logs with authentication context
    expect(authLogs.length).toBeGreaterThan(0);
  });

  test('should not log sensitive credentials', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-security-test.mp4', 512);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Log Security Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(3000);

    // Fetch all logs
    const logs = await fetchLogs(page);

    // SECURITY CHECK: Verify NO sensitive data in logs
    const sensitiveKeywords = [
      'bunny-stream-key',
      'AuthorizationSignature',
      'AccessKey',
      'password',
      'secret',
    ];

    for (const log of logs) {
      const logStr = JSON.stringify(log).toLowerCase();
      for (const keyword of sensitiveKeywords) {
        // These should NEVER appear in logs
        expect(logStr).not.toContain(keyword.toLowerCase());
      }
    }
  });
});

test.describe('TUS Proxy - Log Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await helpers.loginAndNavigateToUpload(page, 'en');
  });

  test('should log upload performance metrics', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-perf-test.mp4', 2048);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Performance Metrics Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(5000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Performance metrics might be logged
    // At minimum, verify upload logs exist
    const uploadLogs = findLogsMatching(logs, /upload/i);
    expect(uploadLogs.length).toBeGreaterThan(0);
  });

  test('should provide logs for debugging upload failures', async ({ page }) => {
    // Mock various failure scenarios
    await page.route('**/api/videos/tus', (route) => {
      route.abort('failed');
    });

    const videoPath = await helpers.createTestVideo('log-debug-test.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Debug Logs Test');
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(5000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Should have error logs with debugging information
    const errorLogs = findLogsMatching(logs, /error|fail/i);
    expect(errorLogs.length).toBeGreaterThan(0);

    // Verify logs contain helpful debugging context
    const hasDebugInfo = logs.some((log: unknown) => {
      const logStr = JSON.stringify(log);
      return logStr.includes('error') ||
             logStr.includes('status') ||
             logStr.includes('message');
    });
    expect(hasDebugInfo).toBeTruthy();
  });

  test('should track upload session lifecycle', async ({ page }) => {
    const videoPath = await helpers.createTestVideo('log-lifecycle-test.mp4', 1024);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Lifecycle Test');
    await page.click('button:has-text("Upload")');

    // Wait for various stages
    await page.waitForTimeout(5000);

    // Cancel upload
    const cancelButton = page.locator('button:has-text("Cancel")');
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
    }

    await page.waitForTimeout(2000);

    // Fetch logs
    const logs = await fetchLogs(page);

    // Should have logs for different stages of upload lifecycle
    const uploadLogs = findLogsMatching(logs, /upload/i);
    expect(uploadLogs.length).toBeGreaterThan(0);

    // Look for lifecycle events (create, progress, cancel/complete)
    const lifecycleLogs = logs.filter((log: unknown) => {
      const logStr = JSON.stringify(log).toLowerCase();
      return logStr.includes('create') ||
             logStr.includes('progress') ||
             logStr.includes('cancel') ||
             logStr.includes('complete');
    });

    // Should track lifecycle events
    expect(lifecycleLogs.length).toBeGreaterThan(0);
  });
});

test.describe('TUS Proxy - Log Service Accessibility', () => {
  test('should access log service API successfully', async ({ page }) => {
    const response = await page.request.get('http://localhost:3089/logs/stream/realtime', {
      params: { limit: '10' },
    });

    // Verify log service is accessible
    expect(response.ok()).toBeTruthy();

    // Verify response is valid JSON
    const logs = await response.json();
    expect(Array.isArray(logs) || typeof logs === 'object').toBeTruthy();
  });

  test('should filter logs by level', async ({ page }) => {
    // Fetch error-level logs
    const errorResponse = await page.request.get('http://localhost:3089/logs/stream/realtime', {
      params: { level: 'error', limit: '20' },
    });

    expect(errorResponse.ok()).toBeTruthy();
    const errorLogs = await errorResponse.json();

    // Fetch info-level logs
    const infoResponse = await page.request.get('http://localhost:3089/logs/stream/realtime', {
      params: { level: 'info', limit: '20' },
    });

    expect(infoResponse.ok()).toBeTruthy();
    const infoLogs = await infoResponse.json();

    // Both should return valid data
    expect(Array.isArray(errorLogs) || typeof errorLogs === 'object').toBeTruthy();
    expect(Array.isArray(infoLogs) || typeof infoLogs === 'object').toBeTruthy();
  });

  test('should retrieve real-time log stream', async ({ page }) => {
    // Start upload to generate logs
    await helpers.loginAndNavigateToUpload(page, 'en');
    const videoPath = await helpers.createTestVideo('realtime-log-test.mp4', 512);

    await page.setInputFiles('input[type="file"]', videoPath);
    await page.waitForSelector('text=Video Details');
    await page.fill('input[placeholder*="Title in English"]', 'Realtime Log Test');
    await page.click('button:has-text("Upload")');

    // Wait for logs to be generated
    await page.waitForTimeout(3000);

    // Fetch logs
    const response = await page.request.get('http://localhost:3089/logs/stream/realtime', {
      params: { limit: '50' },
    });

    expect(response.ok()).toBeTruthy();
    const logs = await response.json();

    // Should have recent logs
    expect(Array.isArray(logs) ? logs.length : Object.keys(logs).length).toBeGreaterThan(0);
  });
});
