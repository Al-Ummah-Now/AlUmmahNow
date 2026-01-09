import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { LOG_DIR } from '../index';

interface LogEntry {
  timestamp: string;
  level: string;
  app: string;
  message: string;
  rawLine: string;
}

export class StreamLogsRealtime extends OpenAPIRoute {
  schema = {
    tags: ['Logs'],
    summary: 'Real-time log streaming with SSE',
    description: 'Stream log entries in real-time using Server-Sent Events. Monitors all log files and sends new entries as they are written.',
    request: {
      query: z.object({
        level: Str({ description: 'Filter by log level (debug, info, warn, error)', required: false }),
        app: Str({ description: 'Filter by specific app name', required: false }),
      }),
    },
    responses: {
      '200': {
        description: 'Server-Sent Events stream',
        content: {
          'text/event-stream': {
            schema: z.object({
              timestamp: z.string(),
              level: z.string(),
              app: z.string(),
              message: z.string(),
              rawLine: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { level: levelFilter, app: appFilter } = request.query;

    // Set up Server-Sent Events headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('Access-Control-Allow-Origin', '*');

    const encoder = new TextEncoder();
    let isActive = true;

    // Track file positions to only read new content
    const filePositions = new Map<string, number>();

    // Initialize file positions
    const initializePositions = async () => {
      try {
        const fs = await import('node:fs/promises');
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(f => f.endsWith('.log'));

        for (const file of logFiles) {
          const appName = file.replace('.log', '');

          // Skip if app filter is set and doesn't match
          if (appFilter && appName !== appFilter) {
            continue;
          }

          const filePath = join(LOG_DIR, file);
          if (existsSync(filePath)) {
            const stats = await stat(filePath);
            filePositions.set(appName, stats.size);
          }
        }
      } catch (error) {
        console.error('[LOG-SERVICE] Error initializing file positions:', error);
      }
    };

    // Read new content from a log file
    const readNewContent = async (appName: string): Promise<LogEntry[]> => {
      const entries: LogEntry[] = [];
      const filePath = join(LOG_DIR, `${appName}.log`);

      if (!existsSync(filePath)) {
        return entries;
      }

      try {
        const stats = await stat(filePath);
        const currentPosition = filePositions.get(appName) || 0;

        // If file was truncated, reset position
        if (stats.size < currentPosition) {
          filePositions.set(appName, 0);
          return entries;
        }

        // If no new content, return
        if (stats.size === currentPosition) {
          return entries;
        }

        // Read only new content
        const fs = await import('node:fs/promises');
        const fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.allocUnsafe(stats.size - currentPosition);
        await fileHandle.read(buffer, 0, buffer.length, currentPosition);
        await fileHandle.close();

        const newContent = buffer.toString('utf8');
        const lines = newContent.split('\n').filter(line => line.trim());

        for (const line of lines) {
          // Parse log line format: [timestamp] [LEVEL] message
          const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.+)$/);
          if (match) {
            const [, timestamp, logLevel, message] = match;

            // Filter by level if specified
            if (levelFilter && logLevel.toLowerCase() !== levelFilter.toLowerCase()) {
              continue;
            }

            entries.push({
              timestamp,
              level: logLevel,
              app: appName,
              message,
              rawLine: line,
            });
          }
        }

        // Update position
        filePositions.set(appName, stats.size);
      } catch (error) {
        console.error(`[LOG-SERVICE] Error reading new content from ${appName}:`, error);
      }

      return entries;
    };

    // Send SSE message
    const sendEvent = (data: LogEntry) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      return encoder.encode(message);
    };

    // Send initial connection message
    const sendComment = (comment: string) => {
      const message = `: ${comment}\n\n`;
      return encoder.encode(message);
    };

    // Create readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        // Initialize file positions
        await initializePositions();

        // Send initial connection message
        controller.enqueue(sendComment('Connected to log stream'));

        // Watch log directory for changes
        const watcher = watch(LOG_DIR, { recursive: false }, async (eventType, filename) => {
          if (!isActive || !filename || !filename.endsWith('.log')) {
            return;
          }

          const appName = filename.replace('.log', '');

          // Skip if app filter is set and doesn't match
          if (appFilter && appName !== appFilter) {
            return;
          }

          // Read new content and send to client
          const entries = await readNewContent(appName);
          for (const entry of entries) {
            if (isActive) {
              controller.enqueue(sendEvent(entry));
            }
          }
        });

        // Send keepalive every 30 seconds
        const keepaliveInterval = setInterval(() => {
          if (isActive) {
            controller.enqueue(sendComment('keepalive'));
          }
        }, 30000);

        // Cleanup on disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          isActive = false;
          watcher.close();
          clearInterval(keepaliveInterval);
          controller.close();
        });
      },

      cancel() {
        isActive = false;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
