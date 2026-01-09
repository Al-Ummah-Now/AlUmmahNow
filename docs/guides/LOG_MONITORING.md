# Log Monitoring Guide

This guide explains how to monitor logs in real-time using the Log Service API and the log monitoring tool.

## Overview

The Al Ummah Now monorepo includes a centralized logging system:

1. **Log Service** (`apps/log-service`) - HTTP API server that receives logs and writes them to files
2. **Logger Package** (`@al-ummah/logger`) - Shared logging utility used by all apps
3. **Log Monitor** (`monitor-logs.ts`) - CLI tool for real-time log monitoring via the API

## Log Service API

The log service runs at `http://localhost:3089` during local development.

### API Endpoints

#### GET /health
Health check endpoint
```bash
curl http://localhost:3089/health
```

#### GET /logs
List all available log files
```bash
curl http://localhost:3089/logs
```

Response:
```json
{
  "logDirectory": "/home/user/AlUmmahNow/logs",
  "files": ["web.log", "api-videos.log", "processor.log"]
}
```

#### GET /logs/:appName
Retrieve logs for a specific app with filtering

**Query Parameters:**
- `lines` - Number of lines to return (default: all)
- `level` - Filter by log level (`debug`, `info`, `warn`, `error`)
- `tail` - If `true`, return last N lines instead of first N

**Examples:**
```bash
# Get all logs for web app
curl http://localhost:3089/logs/web

# Get last 100 lines
curl "http://localhost:3089/logs/web?lines=100&tail=true"

# Get only error logs
curl "http://localhost:3089/logs/web?level=error"

# Get last 50 error logs
curl "http://localhost:3089/logs/web?level=error&lines=50&tail=true"
```

Response:
```json
{
  "appName": "web",
  "totalLines": 150,
  "lines": [
    "[2025-11-18T08:15:27.578Z] [INFO] Server started",
    "[2025-11-18T08:15:28.123Z] [ERROR] Connection failed"
  ],
  "filters": {
    "level": "error",
    "maxLines": 50,
    "tail": true
  }
}
```

#### POST /log
Write a single log entry
```bash
curl -X POST http://localhost:3089/log \
  -H "Content-Type: application/json" \
  -d '{"app":"web","level":"info","message":"Test log","data":{"foo":"bar"}}'
```

#### POST /log/batch
Write multiple log entries at once
```bash
curl -X POST http://localhost:3089/log/batch \
  -H "Content-Type: application/json" \
  -d '{"logs":[
    {"app":"web","level":"info","message":"Log 1"},
    {"app":"api","level":"error","message":"Log 2"}
  ]}'
```

## Log Monitor Tool

The log monitor continuously fetches and displays new logs from the log service API with color-coded output.

### Usage

#### Monitor all apps
```bash
pnpm logs:monitor
```

#### Monitor specific app
```bash
pnpm logs:monitor:web         # Only web app
pnpm logs:monitor:api         # Only api-videos app
tsx monitor-logs.ts web api-videos processor  # Multiple apps
```

#### Filter by log level
```bash
pnpm logs:monitor:errors      # Only ERROR logs
tsx monitor-logs.ts --level=warn  # Only WARN logs
tsx monitor-logs.ts --level=info  # Only INFO logs
```

#### Start with recent logs
```bash
tsx monitor-logs.ts --tail=100    # Show last 100 lines on startup
tsx monitor-logs.ts web --tail=50 # Last 50 lines for web app
```

#### Combine options
```bash
# Monitor web and API, show last 100 lines, only errors
tsx monitor-logs.ts web api-videos --tail=100 --level=error
```

### Output Format

The log monitor displays logs with color-coded levels:

```
[timestamp] [app] [level] message
```

**Colors:**
- **ERROR** - Red
- **WARN** - Yellow
- **INFO** - Blue
- **DEBUG** - Gray
- Timestamps - Gray
- App names - Cyan

### How It Works

1. **Initial load**: Fetches existing logs (optionally with `--tail` to limit)
2. **Polling**: Checks for new logs every 1 second
3. **Incremental updates**: Only displays new logs since last check
4. **Non-blocking**: Continues running until you press Ctrl+C

## Log File Format

All log files use ISO 8601 timestamps with the following format:

```
[YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [functionName] message data
```

**Example:**
```
[2025-11-18T08:15:27.578Z] [INFO] [updateChannelCover] Auth context {"hasToken":true,"userId":"abc123"}
[2025-11-18T08:15:27.776Z] [ERROR] [updateChannelCover] Failed {"status":401,"error":"Unauthorized"}
```

**Format details:**
- **Timestamp**: ISO 8601 with milliseconds and UTC timezone (Z)
- **Level**: `DEBUG`, `INFO`, `WARN`, or `ERROR`
- **Function**: Optional function/endpoint name in brackets
- **Message**: Human-readable message
- **Data**: Optional JSON object with additional context

## Log Files Location

All logs are written to `/home/user/AlUmmahNow/logs/`:

- `web.log` - Next.js frontend logs
- `api-videos.log` - API backend logs
- `processor.log` - Queue processor logs
- `websocket-server.log` - WebSocket server logs
- `log-service.log` - Log service itself (if configured)

## Starting the Log Service

The log service must be running for the monitor to work:

```bash
# In one terminal
pnpm log-service:dev

# In another terminal
pnpm logs:monitor
```

**Important:** The log service only runs in local development, not in production.

## Troubleshooting

### "Cannot connect to log service"

**Solution:** Make sure the log service is running:
```bash
pnpm log-service:dev
```

### "No log files found"

**Solution:** Generate some logs by using the apps:
```bash
# Start the web app to generate logs
pnpm web:dev

# Or trigger an API call
curl http://127.0.0.1:8686/api/videos
```

### Monitor shows "UNKNOWN" for log level

**Solution:** This happens when the log format doesn't match the expected pattern. The `@al-ummah/logger` package should be used for all logging to ensure consistent format.

### Logs not updating in real-time

**Solution:**
1. Check that the log service is running
2. Verify apps are using `@al-ummah/logger` package
3. For Cloudflare Workers apps, ensure they're configured to use HTTP logging

## Integration with Apps

### Next.js (apps/web)

Uses `@al-ummah/logger` with direct file I/O:

```typescript
import { createLogger } from '@al-ummah/logger';

const logger = createLogger('web', {
  logLevel: 'info',
  fileLogging: true,
  consoleLogging: true,
});

logger.info('Server started', { port: 3000 });
logger.error('Failed to connect', error);
```

### Cloudflare Workers (api-videos, processor, websocket-server)

Uses `@al-ummah/logger` with HTTP logging (sends logs to log service):

```typescript
import { createLogger } from '@al-ummah/logger';

const logger = createLogger('api-videos', {
  logLevel: 'info',
  fileLogging: true,
  consoleLogging: true,
  logServiceUrl: 'http://localhost:3089',
  forceHttpLogging: true, // Force HTTP even in local dev
});

logger.info('Request received', { method: 'GET', path: '/api/videos' });
```

## Best Practices

1. **Always use the logger package** instead of `console.log`
2. **Include context data** in log messages for better debugging
3. **Use appropriate log levels**:
   - `debug` - Detailed debugging information
   - `info` - General informational messages
   - `warn` - Warning messages (something unusual but not critical)
   - `error` - Error messages (something failed)
4. **Structure your data** - Pass objects as the second parameter for consistent formatting
5. **Keep messages concise** - Log messages should be short and clear
6. **Don't log sensitive data** - Avoid logging passwords, tokens, or PII

## Examples

### Monitoring during development

**Terminal 1:** Start log service
```bash
pnpm log-service:dev
```

**Terminal 2:** Start apps
```bash
pnpm dev
```

**Terminal 3:** Monitor logs
```bash
pnpm logs:monitor
```

### Debugging API issues

```bash
# Monitor only API logs with errors
tsx monitor-logs.ts api-videos --level=error

# Monitor API with last 100 lines
tsx monitor-logs.ts api-videos --tail=100
```

### Monitoring production-like workflow

```bash
# Monitor all apps, show only warnings and errors
tsx monitor-logs.ts --level=warn
```
