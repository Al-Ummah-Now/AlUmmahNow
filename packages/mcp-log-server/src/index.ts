#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:3089';

interface LogEntry {
  timestamp: string;
  level: string;
  app: string;
  message: string;
  rawLine: string;
}

interface StreamLogsResponse {
  totalLines: number;
  apps: string[];
  lines: LogEntry[];
  filters: {
    level: string | null;
    app: string | null;
    maxLines: number | null;
    tail: boolean;
  };
}

interface ListFilesResponse {
  files: string[];
  logDirectory: string;
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'get_logs',
    description: 'Get recent logs from all apps or a specific app. Returns structured log entries with timestamps, levels, and messages.',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'Filter by app name (e.g., "admin-api", "api-videos", "web", "processor", "websocket")',
        },
        level: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error'],
          description: 'Filter by log level',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to return (default: 50, max: 500)',
          default: 50,
        },
        tail: {
          type: 'boolean',
          description: 'If true, return most recent logs first (default: true)',
          default: true,
        },
      },
    },
  },
  {
    name: 'watch_logs',
    description: 'Watch logs in real-time for a specified duration. Useful for monitoring new log entries as they happen during debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'Filter by app name (e.g., "admin-api", "api-videos", "web")',
        },
        level: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error'],
          description: 'Filter by log level',
        },
        duration: {
          type: 'number',
          description: 'How long to watch for new logs in seconds (default: 5, max: 30)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'list_log_apps',
    description: 'List all available app names that have log files',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_logs',
    description: 'Search logs for specific text patterns across all apps or a specific app',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text pattern to search for in log messages',
        },
        app: {
          type: 'string',
          description: 'Filter by app name',
        },
        level: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error'],
          description: 'Filter by log level',
        },
        lines: {
          type: 'number',
          description: 'Max number of matching lines to return (default: 100)',
          default: 100,
        },
      },
      required: ['query'],
    },
  },
];

// Fetch logs from the log service
async function fetchLogs(params: {
  app?: string;
  level?: string;
  lines?: number;
  tail?: boolean;
}): Promise<StreamLogsResponse> {
  const searchParams = new URLSearchParams();
  if (params.app) searchParams.set('app', params.app);
  if (params.level) searchParams.set('level', params.level);
  if (params.lines) searchParams.set('lines', String(Math.min(params.lines, 500)));
  searchParams.set('tail', params.tail !== false ? 'true' : 'false');

  const url = `${LOG_SERVICE_URL}/logs/stream?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.statusText}`);
  }

  return response.json();
}

// Watch logs using SSE for a duration
async function watchLogs(params: {
  app?: string;
  level?: string;
  duration?: number;
}): Promise<LogEntry[]> {
  const duration = Math.min(params.duration || 5, 30) * 1000;
  const entries: LogEntry[] = [];

  const searchParams = new URLSearchParams();
  if (params.app) searchParams.set('app', params.app);
  if (params.level) searchParams.set('level', params.level);

  const url = `${LOG_SERVICE_URL}/logs/stream/realtime?${searchParams.toString()}`;

  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve(entries);
    }, duration);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok) {
        clearTimeout(timeout);
        reject(new Error(`Failed to connect to log stream: ${response.statusText}`));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        clearTimeout(timeout);
        reject(new Error('No response body'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  entries.push(data);
                } catch {
                  // Skip invalid JSON (comments, etc.)
                }
              }
            }
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('Stream error:', err);
          }
        }
      };

      readStream();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        clearTimeout(timeout);
        reject(err);
      }
    }
  });
}

// List available log apps
async function listLogApps(): Promise<string[]> {
  const response = await fetch(`${LOG_SERVICE_URL}/logs/files`);

  if (!response.ok) {
    throw new Error(`Failed to list log files: ${response.statusText}`);
  }

  const data: ListFilesResponse = await response.json();
  return data.files.map((f) => f.replace('.log', ''));
}

// Format log entries for display
function formatLogEntries(entries: LogEntry[], maxLength = 200): string {
  if (entries.length === 0) {
    return 'No log entries found.';
  }

  return entries
    .map((entry) => {
      const message =
        entry.message.length > maxLength
          ? entry.message.slice(0, maxLength) + '...'
          : entry.message;
      return `[${entry.timestamp}] [${entry.app}] [${entry.level}] ${message}`;
    })
    .join('\n');
}

// Create server
const server = new Server(
  {
    name: 'al-ummah-log-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_logs': {
        const params = args as {
          app?: string;
          level?: string;
          lines?: number;
          tail?: boolean;
        };

        const result = await fetchLogs({
          app: params.app,
          level: params.level,
          lines: params.lines || 50,
          tail: params.tail !== false,
        });

        const formatted = formatLogEntries(result.lines);
        const summary = `Found ${result.totalLines} log entries${params.app ? ` for ${params.app}` : ''}${params.level ? ` at ${params.level} level` : ''}`;

        return {
          content: [
            {
              type: 'text',
              text: `${summary}\n\n${formatted}`,
            },
          ],
        };
      }

      case 'watch_logs': {
        const params = args as {
          app?: string;
          level?: string;
          duration?: number;
        };

        const duration = Math.min(params.duration || 5, 30);
        const entries = await watchLogs({
          app: params.app,
          level: params.level,
          duration,
        });

        const formatted = formatLogEntries(entries);
        const summary = `Watched for ${duration} seconds. Captured ${entries.length} new log entries${params.app ? ` for ${params.app}` : ''}`;

        return {
          content: [
            {
              type: 'text',
              text: entries.length > 0 ? `${summary}\n\n${formatted}` : summary,
            },
          ],
        };
      }

      case 'list_log_apps': {
        const apps = await listLogApps();
        return {
          content: [
            {
              type: 'text',
              text: `Available log apps:\n${apps.map((a) => `- ${a}`).join('\n')}`,
            },
          ],
        };
      }

      case 'search_logs': {
        const params = args as {
          query: string;
          app?: string;
          level?: string;
          lines?: number;
        };

        if (!params.query) {
          return {
            content: [{ type: 'text', text: 'Error: query parameter is required' }],
            isError: true,
          };
        }

        // Fetch more logs to search through
        const result = await fetchLogs({
          app: params.app,
          level: params.level,
          lines: 500,
          tail: true,
        });

        // Filter by search query (case-insensitive)
        const queryLower = params.query.toLowerCase();
        const matches = result.lines.filter(
          (entry) =>
            entry.message.toLowerCase().includes(queryLower) ||
            entry.rawLine.toLowerCase().includes(queryLower)
        );

        const limited = matches.slice(0, params.lines || 100);
        const formatted = formatLogEntries(limited);
        const summary = `Found ${matches.length} logs matching "${params.query}"${params.app ? ` in ${params.app}` : ''}`;

        return {
          content: [
            {
              type: 'text',
              text: matches.length > 0 ? `${summary}\n\n${formatted}` : summary,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Al Ummah Log MCP Server running on stdio');
}

main().catch(console.error);
