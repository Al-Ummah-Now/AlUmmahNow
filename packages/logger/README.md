# @al-ummah/logger

Shared logging utility for Al Ummah Now applications.

## Features

- **Console logging** - Always available in all environments
- **File logging** - Automatic in local development (wrangler dev), disabled in production
- **Structured format** - Timestamped logs with severity levels
- **Configurable** - Adjust log levels and output destinations
- **Non-blocking** - Async file writes don't impact performance
- **Type-safe** - Full TypeScript support

## Installation

This is a private monorepo package. Install via workspace protocol:

```bash
pnpm add @al-ummah/logger --filter @al-ummah/your-app
```

Or add to your app's `package.json`:

```json
{
  "dependencies": {
    "@al-ummah/logger": "workspace:*"
  }
}
```

## Usage

### Quick Start

```typescript
import { createLogger } from '@al-ummah/logger';

// Create logger for your app
const logger = createLogger('api-videos');

logger.info('Server started', { port: 3000 });
logger.warn('Deprecated API used', { endpoint: '/old-api' });
logger.error('Failed to connect', error);
```

### Advanced Configuration

```typescript
import { Logger } from '@al-ummah/logger';

const logger = new Logger({
  logLevel: 'debug',
  logFilePath: 'logs/my-app.log',
  consoleLogging: true,
  fileLogging: true
});

logger.debug('Debug info', { userId: '123' });
logger.info('User logged in', { email: 'user@example.com' });
```

### API Reference

#### `createLogger(appName, config?)`

Create a logger instance with automatic file path configuration.

**Parameters:**
- `appName` (string) - Application name (e.g., 'api-videos', 'processor')
- `config` (optional) - Logger configuration (excluding logFilePath)

**Returns:** `Logger` instance

#### `new Logger(config?)`

Create a logger instance with full configuration control.

**Parameters:**
- `config.logLevel` - Minimum log level ('debug' | 'info' | 'warn' | 'error'). Default: 'info'
- `config.logFilePath` - Path to log file relative to monorepo root. Default: undefined
- `config.consoleLogging` - Enable console output. Default: true
- `config.fileLogging` - Enable file logging (local dev only). Default: true

#### Logger Methods

- `logger.debug(message, data?)` - Log debug message
- `logger.info(message, data?)` - Log info message
- `logger.warn(message, data?)` - Log warning message
- `logger.error(message, error?)` - Log error message
- `logger.getLogLevel()` - Get current log level
- `logger.setLogLevel(level)` - Set log level
- `logger.isFileLoggingEnabled()` - Check if file logging is active
- `logger.getLogFilePath()` - Get log file path (if enabled)

## Log Format

Logs are written in the following format:

```
[2025-11-15T04:09:45.123Z] [LEVEL] message {"data":"object"}
```

**Example:**
```
[2025-11-15T10:30:45.123Z] [INFO] Server started {"port":3000}
[2025-11-15T10:30:46.456Z] [WARN] Deprecated API used {"endpoint":"/old-api"}
[2025-11-15T10:30:47.789Z] [ERROR] Failed to connect {"code":"ECONNREFUSED"}
```

## File Logging Behavior

### Local Development (wrangler dev)
- ✅ File logging **enabled**
- ✅ Console logging **enabled**
- 📁 Logs written to `/logs/{app}.log` in monorepo root
- 🔄 Hot reload preserves log files

### Production (Cloudflare Workers)
- ❌ File logging **disabled** (no filesystem access)
- ✅ Console logging **enabled**
- 📊 Use Cloudflare Logs/Analytics for production logging

## Environment Detection

The logger automatically detects the runtime environment:

- **Local dev**: Checks for `process.cwd` function (Node.js)
- **Production**: No file system access, skips file logging

## Log Levels

Severity levels in order:

1. **debug** - Verbose debugging information
2. **info** - General informational messages
3. **warn** - Warning messages
4. **error** - Error messages

Set minimum level with `logLevel` config. Only logs at or above the configured level will be output.

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import { Logger, LogLevel, LoggerConfig, createLogger } from '@al-ummah/logger';

const config: LoggerConfig = {
  logLevel: 'debug',
  logFilePath: 'logs/my-app.log'
};

const logger: Logger = createLogger('my-app', config);
```

## Cloudflare Workers Compatibility

Requires `nodejs_compat` compatibility flag in `wrangler.toml`/`wrangler.jsonc`:

```toml
compatibility_flags = ["nodejs_compat"]
```

Or:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"]
}
```

## Migration from Old Logger

### Before (per-app logger)

```typescript
import Logger from './lib/logger';

const logger = new Logger('info');
logger.info('Message');
```

### After (shared package)

```typescript
import { createLogger } from '@al-ummah/logger';

const logger = createLogger('api-videos', { logLevel: 'info' });
logger.info('Message');
```

## Development

```bash
# Build the package
pnpm --filter @al-ummah/logger build

# Watch mode (during development)
pnpm --filter @al-ummah/logger dev

# Clean build artifacts
pnpm --filter @al-ummah/logger clean
```

## License

UNLICENSED - Private package for Al Ummah Now monorepo.

## Logging policy

Levels per environment, redaction, request/job summaries and Workers Logs
sampling are documented in [docs/operations/logging.md](../../docs/operations/logging.md).
Apps use `appLogger('<app>')` and never set a level in code; Workers wrap their
handlers with `withLogging()` so each invocation applies its `env.LOG_LEVEL`.
