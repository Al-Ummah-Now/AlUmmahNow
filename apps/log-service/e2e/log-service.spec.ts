/**
 * E2E Tests for Log Service using Playwright
 *
 * Tests the HTTP API endpoints for receiving and storing logs
 */

import { test, expect } from '@playwright/test';
import { rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const BASE_URL = 'http://localhost:3089';
const TEST_LOG_DIR = join(process.cwd(), '../../logs');

test.describe('Log Service API', () => {
  test.beforeAll(async () => {
    // Ensure log directory exists
    if (!existsSync(TEST_LOG_DIR)) {
      await mkdir(TEST_LOG_DIR, { recursive: true });
    }
  });

  test('GET / - should return service information', async ({ request }) => {
    const response = await request.get(BASE_URL);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.service).toBe('Al Ummah Now - Local Logging Service');
    expect(data.version).toBe('1.0.0');
    expect(data.endpoints).toHaveProperty('health');
    expect(data.endpoints).toHaveProperty('log');
    expect(data.endpoints).toHaveProperty('logBatch');
    expect(data.endpoints).toHaveProperty('logs');
  });

  test('GET /health - should return healthy status', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('log-service');
    expect(data.logDirectory).toBeTruthy();
  });

  test('GET /logs - should return list of log files', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/logs`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('logDirectory');
    expect(data).toHaveProperty('files');
    expect(Array.isArray(data.files)).toBeTruthy();
  });

  test('POST /log - should accept and save a log message', async ({ request }) => {
    const timestamp = Date.now();
    const logEntry = {
      app: 'playwright-test-app',
      level: 'info',
      message: 'Test log message from Playwright',
      data: { test: 'data', timestamp },
    };

    const response = await request.post(`${BASE_URL}/log`, {
      data: logEntry,
    });

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.success).toBe(true);

    // Wait for file write
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify log file was created
    const logsResponse = await request.get(`${BASE_URL}/logs`);
    const logsData = await logsResponse.json();
    expect(logsData.files).toContain('playwright-test-app.log');
  });

  test('POST /log - should handle all log levels', async ({ request }) => {
    const levels = ['debug', 'info', 'warn', 'error'];

    for (const level of levels) {
      const logEntry = {
        app: `test-${level}-app`,
        level,
        message: `Test ${level} message`,
        data: { level, timestamp: Date.now() },
      };

      const response = await request.post(`${BASE_URL}/log`, {
        data: logEntry,
      });

      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.success).toBe(true);
    }
  });

  test('POST /log - should reject log without required fields', async ({ request }) => {
    const invalidLog = {
      app: 'test-app',
      // missing level and message
    };

    const response = await request.post(`${BASE_URL}/log`, {
      data: invalidLog,
    });

    expect(response.status()).toBe(400);

    const result = await response.json();
    expect(result.error).toContain('Missing required fields');
  });

  test('POST /log - should handle log without data field', async ({ request }) => {
    const logEntry = {
      app: 'test-no-data-playwright',
      level: 'info',
      message: 'Message without data',
    };

    const response = await request.post(`${BASE_URL}/log`, {
      data: logEntry,
    });

    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.success).toBe(true);
  });

  test('POST /log - should handle complex nested data', async ({ request }) => {
    const logEntry = {
      app: 'test-complex-playwright',
      level: 'info',
      message: 'Complex data test',
      data: {
        user: { id: 123, name: 'Test User' },
        metadata: { timestamp: Date.now(), version: '1.0.0' },
        nested: { deeply: { nested: { value: 'test' } } },
      },
    };

    const response = await request.post(`${BASE_URL}/log`, {
      data: logEntry,
    });

    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.success).toBe(true);
  });

  test('POST /log/batch - should accept multiple log messages', async ({ request }) => {
    const batchLogs = {
      logs: [
        {
          app: 'batch-playwright-app',
          level: 'info',
          message: 'First log',
          data: { index: 1 },
        },
        {
          app: 'batch-playwright-app',
          level: 'debug',
          message: 'Second log',
          data: { index: 2 },
        },
        {
          app: 'batch-playwright-app',
          level: 'error',
          message: 'Third log',
          data: { index: 3 },
        },
      ],
    };

    const response = await request.post(`${BASE_URL}/log/batch`, {
      data: batchLogs,
    });

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.logsWritten).toBe(3);
  });

  test('POST /log/batch - should handle multiple apps', async ({ request }) => {
    const batchLogs = {
      logs: [
        {
          app: 'playwright-app-one',
          level: 'info',
          message: 'Log from app one',
        },
        {
          app: 'playwright-app-two',
          level: 'info',
          message: 'Log from app two',
        },
        {
          app: 'playwright-app-one',
          level: 'warn',
          message: 'Another log from app one',
        },
      ],
    };

    const response = await request.post(`${BASE_URL}/log/batch`, {
      data: batchLogs,
    });

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.logsWritten).toBe(3);
  });

  test('POST /log/batch - should reject batch without logs array', async ({ request }) => {
    const invalidBatch = {
      notLogs: [],
    };

    const response = await request.post(`${BASE_URL}/log/batch`, {
      data: invalidBatch,
    });

    expect(response.status()).toBe(400);

    const result = await response.json();
    expect(result.error).toContain('logs must be an array');
  });

  test('POST /log/batch - should handle empty batch', async ({ request }) => {
    const batchLogs = {
      logs: [],
    };

    const response = await request.post(`${BASE_URL}/log/batch`, {
      data: batchLogs,
    });

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.logsWritten).toBe(0);
  });

  test('CORS - should include proper headers', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);

    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('GET');
    expect(headers['access-control-allow-methods']).toContain('POST');
  });

  test('Concurrent requests - should handle load', async ({ request }) => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      request.post(`${BASE_URL}/log`, {
        data: {
          app: 'playwright-concurrent',
          level: 'info',
          message: `Concurrent log ${i}`,
          data: { index: i },
        },
      })
    );

    const responses = await Promise.all(promises);

    // All requests should succeed
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.success).toBe(true);
    }
  });

  test('Error handling - should handle malformed JSON gracefully', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/log`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: 'this is not valid JSON',
    });

    // Should return error (400 or 500)
    expect(response.ok()).toBeFalsy();
  });

  test('Performance - should respond quickly to health checks', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${BASE_URL}/health`);
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(100); // Should respond in under 100ms
  });

  test('Performance - batch logging should be efficient', async ({ request }) => {
    const largeBatch = {
      logs: Array.from({ length: 100 }, (_, i) => ({
        app: 'perf-test-app',
        level: 'info',
        message: `Performance test log ${i}`,
        data: { index: i, timestamp: Date.now() },
      })),
    };

    const start = Date.now();
    const response = await request.post(`${BASE_URL}/log/batch`, {
      data: largeBatch,
    });
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.logsWritten).toBe(100);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  });

  test('GET /logs/:appName - should retrieve logs for specific app', async ({ request }) => {
    // First create some test logs
    await request.post(`${BASE_URL}/log`, {
      data: {
        app: 'pull-test-app',
        level: 'info',
        message: 'First log entry',
      },
    });

    await request.post(`${BASE_URL}/log`, {
      data: {
        app: 'pull-test-app',
        level: 'error',
        message: 'Error log entry',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Retrieve logs
    const response = await request.get(`${BASE_URL}/logs/pull-test-app`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.appName).toBe('pull-test-app');
    expect(data.totalLines).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(data.lines)).toBeTruthy();
    expect(data.lines.length).toBeGreaterThanOrEqual(2);
  });

  test('GET /logs/:appName - should filter by log level', async ({ request }) => {
    // Create logs with different levels
    await request.post(`${BASE_URL}/log/batch`, {
      data: {
        logs: [
          { app: 'filter-test-app', level: 'info', message: 'Info message' },
          { app: 'filter-test-app', level: 'error', message: 'Error message 1' },
          { app: 'filter-test-app', level: 'debug', message: 'Debug message' },
          { app: 'filter-test-app', level: 'error', message: 'Error message 2' },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Retrieve only error logs
    const response = await request.get(`${BASE_URL}/logs/filter-test-app?level=error`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.filters.level).toBe('error');
    expect(data.lines.every((line: string) => line.includes('[ERROR]'))).toBeTruthy();
  });

  test('GET /logs/:appName - should limit number of lines', async ({ request }) => {
    // Create multiple logs
    await request.post(`${BASE_URL}/log/batch`, {
      data: {
        logs: Array.from({ length: 10 }, (_, i) => ({
          app: 'limit-test-app',
          level: 'info',
          message: `Log entry ${i}`,
        })),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Retrieve only 5 lines
    const response = await request.get(`${BASE_URL}/logs/limit-test-app?lines=5`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.totalLines).toBe(5);
    expect(data.lines.length).toBe(5);
  });

  test('GET /logs/:appName - should return last N lines with tail=true', async ({ request }) => {
    // Create multiple logs
    await request.post(`${BASE_URL}/log/batch`, {
      data: {
        logs: Array.from({ length: 10 }, (_, i) => ({
          app: 'tail-test-app',
          level: 'info',
          message: `Log entry ${i}`,
        })),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Retrieve last 3 lines
    const response = await request.get(`${BASE_URL}/logs/tail-test-app?lines=3&tail=true`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.totalLines).toBe(3);
    expect(data.lines.length).toBe(3);
    expect(data.filters.tail).toBe(true);
    // Last line should contain "Log entry 9"
    expect(data.lines[data.lines.length - 1]).toContain('Log entry 9');
  });

  test('GET /logs/:appName - should return 404 for non-existent app', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/logs/non-existent-app`);
    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.error).toBe('Log file not found');
  });

  test('GET /logs/:appName - should prevent directory traversal', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/logs/../etc/passwd`);
    // Hono normalizes the path, so this returns 404 instead of reaching our validation
    expect(response.status()).toBe(404);
  });

  test('GET /logs/:appName - should combine filters', async ({ request }) => {
    // Create logs
    await request.post(`${BASE_URL}/log/batch`, {
      data: {
        logs: [
          { app: 'combo-test-app', level: 'info', message: 'Info 1' },
          { app: 'combo-test-app', level: 'error', message: 'Error 1' },
          { app: 'combo-test-app', level: 'info', message: 'Info 2' },
          { app: 'combo-test-app', level: 'error', message: 'Error 2' },
          { app: 'combo-test-app', level: 'info', message: 'Info 3' },
          { app: 'combo-test-app', level: 'error', message: 'Error 3' },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get last 2 error logs
    const response = await request.get(
      `${BASE_URL}/logs/combo-test-app?level=error&lines=2&tail=true`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.totalLines).toBe(2);
    expect(data.lines.every((line: string) => line.includes('[ERROR]'))).toBeTruthy();
    expect(data.lines[data.lines.length - 1]).toContain('Error 3');
  });
});
