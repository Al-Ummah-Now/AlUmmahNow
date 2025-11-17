/**
 * Local Development Logging Service
 *
 * This service runs ONLY in local development and:
 * - Receives log messages via HTTP from all apps
 * - Writes logs to separate files based on app name
 * - Provides a simple HTTP API for logging
 *
 * NOT deployed to production - only for local development
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const app = new Hono();

// Log directory (relative to monorepo root)
const LOG_DIR = join(process.cwd(), '../../logs');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true });
}

// CORS middleware for local development
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
});

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'log-service',
    logDirectory: LOG_DIR,
  });
});

/**
 * Log endpoint - receives log messages and writes to files
 *
 * POST /log
 * Body: {
 *   app: string,        // App name (e.g., "api-videos", "websocket-server")
 *   level: string,      // Log level ("debug", "info", "warn", "error")
 *   message: string,    // Log message
 *   data?: unknown      // Optional data object
 * }
 */
app.post('/log', async (c) => {
  try {
    const { app: appName, level, message, data } = await c.req.json();

    // Validate required fields
    if (!appName || !level || !message) {
      return c.json({
        error: 'Missing required fields: app, level, message',
      }, 400);
    }

    // Build log line
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

    // Write to app-specific log file
    const logFilePath = join(LOG_DIR, `${appName}.log`);
    await appendFile(logFilePath, logLine, 'utf8');

    return c.json({ success: true });
  } catch (error) {
    console.error('[LOG-SERVICE] Error writing log:', error);
    return c.json({
      error: 'Failed to write log',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Batch log endpoint - receives multiple log messages at once
 *
 * POST /log/batch
 * Body: {
 *   logs: Array<{
 *     app: string,
 *     level: string,
 *     message: string,
 *     data?: unknown
 *   }>
 * }
 */
app.post('/log/batch', async (c) => {
  try {
    const { logs } = await c.req.json();

    if (!Array.isArray(logs)) {
      return c.json({
        error: 'Invalid request: logs must be an array',
      }, 400);
    }

    // Group logs by app for batch writing
    const logsByApp = new Map<string, string>();

    for (const log of logs) {
      const { app: appName, level, message, data } = log;

      if (!appName || !level || !message) {
        continue; // Skip invalid logs
      }

      const timestamp = new Date().toISOString();
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

      const existing = logsByApp.get(appName) || '';
      logsByApp.set(appName, existing + logLine);
    }

    // Write all logs
    const writePromises = Array.from(logsByApp.entries()).map(([appName, content]) => {
      const logFilePath = join(LOG_DIR, `${appName}.log`);
      return appendFile(logFilePath, content, 'utf8');
    });

    await Promise.all(writePromises);

    return c.json({
      success: true,
      logsWritten: logs.length,
    });
  } catch (error) {
    console.error('[LOG-SERVICE] Error writing batch logs:', error);
    return c.json({
      error: 'Failed to write batch logs',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get list of available log files
 */
app.get('/logs', async (c) => {
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(LOG_DIR);
    const logFiles = files.filter(f => f.endsWith('.log'));

    return c.json({
      logDirectory: LOG_DIR,
      files: logFiles,
    });
  } catch (error) {
    return c.json({
      error: 'Failed to read log directory',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Get logs from a specific app
 *
 * GET /logs/:appName?lines=100&level=error
 *
 * Query params:
 * - lines: number of lines to return (default: all)
 * - level: filter by log level (debug, info, warn, error)
 * - tail: if true, return last N lines instead of first N
 */
app.get('/logs/:appName', async (c) => {
  try {
    const appName = c.req.param('appName');
    const lines = c.req.query('lines');
    const level = c.req.query('level');
    const tail = c.req.query('tail') === 'true';

    // Validate app name (prevent directory traversal)
    if (!appName || appName.includes('..') || appName.includes('/')) {
      return c.json({
        error: 'Invalid app name',
      }, 400);
    }

    const logFilePath = join(LOG_DIR, `${appName}.log`);

    // Check if log file exists
    if (!existsSync(logFilePath)) {
      return c.json({
        error: 'Log file not found',
        appName,
      }, 404);
    }

    // Read log file
    const content = await readFile(logFilePath, 'utf8');
    let logLines = content.split('\n').filter(line => line.trim());

    // Filter by level if specified
    if (level) {
      const levelUpper = level.toUpperCase();
      logLines = logLines.filter(line => line.includes(`[${levelUpper}]`));
    }

    // Limit number of lines if specified
    if (lines) {
      const numLines = parseInt(lines, 10);
      if (!isNaN(numLines) && numLines > 0) {
        if (tail) {
          // Return last N lines
          logLines = logLines.slice(-numLines);
        } else {
          // Return first N lines
          logLines = logLines.slice(0, numLines);
        }
      }
    }

    return c.json({
      appName,
      totalLines: logLines.length,
      lines: logLines,
      filters: {
        level: level || null,
        maxLines: lines ? parseInt(lines, 10) : null,
        tail: tail,
      },
    });
  } catch (error) {
    console.error('[LOG-SERVICE] Error reading log file:', error);
    return c.json({
      error: 'Failed to read log file',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Root endpoint
 */
app.get('/', (c) => {
  return c.json({
    service: 'Al Ummah Now - Local Logging Service',
    version: '1.0.0',
    description: 'Development-only logging service for receiving logs via HTTP',
    endpoints: {
      health: 'GET /health',
      log: 'POST /log',
      logBatch: 'POST /log/batch',
      logs: 'GET /logs',
      getLogs: 'GET /logs/:appName?lines=100&level=error&tail=true',
    },
    logDirectory: LOG_DIR,
  });
});

const PORT = 3089;

console.log(`📝 Log Service starting on http://localhost:${PORT}`);
console.log(`📂 Writing logs to: ${LOG_DIR}`);

// Start Node.js HTTP server
serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`✅ Log Service running on http://localhost:${info.port}`);
});
