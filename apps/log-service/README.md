# Log Service

Local development logging service for Al Ummah Now monorepo. Receives logs via HTTP from all apps and writes them to separate log files.

**Note:** This service runs ONLY in local development. It is NOT deployed to production.

## Features

- ✅ HTTP API for receiving logs from all apps
- ✅ Separate log files per app
- ✅ Batch logging support
- ✅ Log retrieval with filtering
- ✅ CORS enabled for local development
- ✅ Comprehensive test coverage (Vitest + Playwright)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the service
pnpm dev

# Service will be available at http://localhost:3089
```

## API Endpoints

### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "log-service",
  "logDirectory": "/path/to/logs"
}
```

### Send Log

```bash
POST /log
Content-Type: application/json

{
  "app": "api-videos",
  "level": "info",
  "message": "Server started",
  "data": { "port": 3000 }
}
```

**Supported log levels:** `debug`, `info`, `warn`, `error`

**Response:**
```json
{
  "success": true
}
```

### Batch Logging

Send multiple logs at once for better performance:

```bash
POST /log/batch
Content-Type: application/json

{
  "logs": [
    {
      "app": "api-videos",
      "level": "info",
      "message": "Request received",
      "data": { "path": "/api/videos" }
    },
    {
      "app": "websocket-server",
      "level": "debug",
      "message": "Connection established"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "logsWritten": 2
}
```

### List Log Files

```bash
GET /logs
```

**Response:**
```json
{
  "logDirectory": "/path/to/logs",
  "files": [
    "api-videos.log",
    "websocket-server.log",
    "processor.log",
    "web.log"
  ]
}
```

### Retrieve Logs

Get logs from a specific app with optional filtering:

```bash
GET /logs/:appName?lines=100&level=error&tail=true
```

**Query Parameters:**
- `lines` - Number of lines to return (default: all)
- `level` - Filter by log level (`debug`, `info`, `warn`, `error`)
- `tail` - If `true`, return last N lines instead of first N

**Examples:**

```bash
# Get all logs for api-videos
GET /logs/api-videos

# Get last 50 lines
GET /logs/api-videos?lines=50&tail=true

# Get only error logs
GET /logs/api-videos?level=error

# Get last 20 error logs
GET /logs/api-videos?level=error&lines=20&tail=true
```

**Response:**
```json
{
  "appName": "api-videos",
  "totalLines": 150,
  "lines": [
    "[2025-11-15T22:33:45.339Z] [INFO] Server started {\"port\":3000}",
    "[2025-11-15T22:34:12.567Z] [ERROR] Database connection failed {\"error\":\"timeout\"}"
  ],
  "filters": {
    "level": "error",
    "maxLines": 20,
    "tail": true
  }
}
```

## Log Format

Each log entry is written in the following format:

```
[TIMESTAMP] [LEVEL] MESSAGE DATA
```

**Example:**
```
[2025-11-15T22:33:45.339Z] [INFO] Server started {"port":3000}
```

## Directory Structure

```
apps/log-service/
├── src/
│   ├── index.ts           # Main service code
│   └── index.test.ts      # Vitest unit tests
├── e2e/
│   └── log-service.spec.ts  # Playwright e2e tests
├── logs/                  # Log files (created at runtime)
├── package.json
├── playwright.config.ts
├── vitest.config.ts
└── tsconfig.json
```

## Testing

### Unit Tests (Vitest)

```bash
# Run all unit tests
pnpm test

# Watch mode
pnpm test:watch

# With UI
pnpm test:ui

# With coverage
pnpm test:coverage
```

### E2E Tests (Playwright)

```bash
# Run all e2e tests
pnpm test:e2e

# With UI
pnpm test:e2e:ui

# Headed mode (see browser)
pnpm test:e2e:headed
```

**Test Coverage:**
- ✅ 18 Vitest unit tests
- ✅ 24 Playwright e2e tests
- ✅ All HTTP endpoints
- ✅ Error handling
- ✅ Filtering & pagination
- ✅ Security (directory traversal prevention)
- ✅ Performance tests
- ✅ Concurrent request handling

## Usage from Apps

### Using the Logger Package

All apps should use the `@al-ummah/logger` package to send logs:

```typescript
import { createLogger } from '@al-ummah/logger';

const logger = createLogger('api-videos', {
  logLevel: 'debug',
  logServiceUrl: 'http://localhost:3089',
});

logger.info('Server started', { port: 3000 });
logger.error('Database error', { error: err.message });
```

The logger package automatically:
- Detects the environment (Workers vs Node.js)
- Uses HTTP logging for Cloudflare Workers
- Uses direct file writes for Node.js apps
- Sends logs to this service in local development

### Manual HTTP Requests

You can also send logs directly via HTTP:

```typescript
fetch('http://localhost:3089/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    app: 'my-app',
    level: 'info',
    message: 'Something happened',
    data: { key: 'value' },
  }),
});
```

## Log File Location

Logs are written to: **`/path/to/monorepo/logs/`**

Each app gets its own log file:
- `logs/api-videos.log`
- `logs/websocket-server.log`
- `logs/processor.log`
- `logs/web.log`

## Development

```bash
# Install dependencies
pnpm install

# Start in watch mode (auto-reload on changes)
pnpm dev

# Run service once
pnpm start

# Type check
pnpm --filter @al-ummah/log-service type-check

# Run all tests (unit + e2e)
pnpm test && pnpm test:e2e
```

## Architecture

- **Framework:** Hono (fast HTTP framework)
- **Runtime:** Node.js with `@hono/node-server`
- **Language:** TypeScript
- **Testing:** Vitest (unit) + Playwright (e2e)

## Security

- ✅ Path traversal prevention (validates app names)
- ✅ CORS enabled only for local development
- ✅ No authentication (local development only)
- ✅ Input validation for all endpoints

## Performance

- Async file writes (non-blocking)
- Batch logging support for high-throughput scenarios
- Handles concurrent requests efficiently
- Fast response times (<100ms for health checks)

## Monitoring

The service logs to console:

```
📝 Log Service starting on http://localhost:3089
📂 Writing logs to: /path/to/logs
✅ Log Service running on http://localhost:3089
```

## Troubleshooting

### Service won't start

Make sure port 3089 is not already in use:

```bash
lsof -i:3089
```

### Logs not appearing

1. Check that the service is running:
   ```bash
   curl http://localhost:3089/health
   ```

2. Check that apps are configured to use the log service:
   ```typescript
   const logger = createLogger('app-name', {
     logServiceUrl: 'http://localhost:3089',
   });
   ```

3. Check the logs directory exists:
   ```bash
   ls -la logs/
   ```

### Permission errors

Ensure the service has write permissions to the logs directory:

```bash
chmod -R 755 logs/
```

## Contributing

When adding new features:

1. Write tests first (TDD)
2. Update this README
3. Ensure all tests pass: `pnpm test && pnpm test:e2e`
4. Update the API documentation in the root endpoint

## License

UNLICENSED - Internal use only
