# File-Based Logging for Local Development

## Overview

All applications now log to separate files during local development for easier debugging and monitoring.

## Quick Start

### Start all apps with file logging:
```bash
./dev-with-logs.sh
```

This will:
- ✅ Start all 5 applications (web, api-videos, processor, websocket-server, shared-types)
- ✅ Create separate log files for each app in `/tmp/al-ummah-logs/`
- ✅ Display status and log file locations
- ✅ Keep running until you press Ctrl+C

### Stop all services:
```bash
kill $(cat /tmp/al-ummah-logs/pids.txt)
```

Or just press `Ctrl+C` in the terminal running `dev-with-logs.sh`

## Log Files Location

All logs are written to: `/tmp/al-ummah-logs/`

Individual log files:
- **Web App**: `/tmp/al-ummah-logs/web.log`
- **API Videos**: `/tmp/al-ummah-logs/api-videos.log`
- **Processor**: `/tmp/al-ummah-logs/processor.log`
- **WebSocket**: `/tmp/al-ummah-logs/websocket.log`
- **Shared Types**: `/tmp/al-ummah-logs/shared-types.log`

## Viewing Logs

### Watch a specific service:
```bash
# API Videos (with systematic logging)
tail -f /tmp/al-ummah-logs/api-videos.log

# Web app
tail -f /tmp/al-ummah-logs/web.log

# Processor
tail -f /tmp/al-ummah-logs/processor.log

# WebSocket server
tail -f /tmp/al-ummah-logs/websocket.log
```

### Watch all logs together:
```bash
tail -f /tmp/al-ummah-logs/*.log
```

### Filter API requests:
```bash
# All API requests
grep "API REQUEST" /tmp/al-ummah-logs/api-videos.log

# All API responses
grep "API RESPONSE" /tmp/al-ummah-logs/api-videos.log

# Specific endpoint
grep "/api/profiles" /tmp/al-ummah-logs/api-videos.log

# Errors only
grep "ERROR\|❌" /tmp/al-ummah-logs/*.log

# Follow specific request by ID
grep "1763178097773-2ovs16l" /tmp/al-ummah-logs/api-videos.log
```

### Search across all logs:
```bash
# Find all occurrences of a user ID
grep "9cc57a53c997b0308ed31596d9b5ea3a" /tmp/al-ummah-logs/*.log

# Find all 500 errors
grep "500" /tmp/al-ummah-logs/*.log

# Find profile-related logs
grep -i "profile" /tmp/al-ummah-logs/*.log
```

## API Videos Systematic Logging

The API Videos app (`/tmp/al-ummah-logs/api-videos.log`) includes detailed systematic logging for ALL endpoints:

**Example log entry:**
```
========================================
[API REQUEST] ========== START ==========
[API REQUEST] Request ID: 1763178097773-2ovs16l
[API REQUEST] Timestamp: 2025-11-15T03:41:37.774Z
[API REQUEST] Method: POST
[API REQUEST] Path: /api/profiles
[API REQUEST] User ID: 9cc57a53c997b0308ed31596d9b5ea3a
[API REQUEST] Headers: {...}
[API REQUEST] Body: {...}
[API REQUEST] ========== PROCESSING ==========
[API RESPONSE] ========== END ==========
[API RESPONSE] Request ID: 1763178097773-2ovs16l
[API RESPONSE] Status: 200
[API RESPONSE] Duration: 282ms
[API RESPONSE] Body: {...}
[API RESPONSE] ✅ Success
========================================
```

See `apps/api-videos/LOGGING.md` for complete API logging documentation.

## Alternative: Manual Logging

If you want to run specific apps only:

```bash
# API Videos only
pnpm --filter @al-ummah/api-videos dev > /tmp/api-videos.log 2>&1 &

# Web app only
pnpm --filter @al-ummah/web dev > /tmp/web.log 2>&1 &

# Processor only
pnpm --filter @al-ummah/processor dev > /tmp/processor.log 2>&1 &
```

## Troubleshooting

### Logs not appearing:
1. Check if services are running: `ps aux | grep -E "wrangler|next"`
2. Check PIDs file: `cat /tmp/al-ummah-logs/pids.txt`
3. Verify log files exist: `ls -lh /tmp/al-ummah-logs/`

### Clear old logs:
```bash
rm -rf /tmp/al-ummah-logs/*.log
```

### Start fresh:
```bash
# Stop all services
kill $(cat /tmp/al-ummah-logs/pids.txt) 2>/dev/null

# Clear logs
rm -rf /tmp/al-ummah-logs

# Restart
./dev-with-logs.sh
```

## Production Logging

**Note**: This file-based logging is **for local development only**.

In production:
- **Cloudflare Workers** (api-videos, processor, websocket-server): Logs go to Cloudflare's logging service
- **Web app** (Next.js on Cloudflare): Logs go to Cloudflare's logging service

Access production logs via:
- Cloudflare Dashboard → Workers & Pages → Your Worker → Logs
- Or use `wrangler tail` command

## Tips

1. **Use separate terminals** for viewing different logs while developing
2. **Use `grep` with colors**: `grep --color=auto "API REQUEST" /tmp/al-ummah-logs/api-videos.log`
3. **Monitor errors in real-time**: `tail -f /tmp/al-ummah-logs/*.log | grep --color=auto "ERROR"`
4. **Archive logs before debugging**: `cp -r /tmp/al-ummah-logs /tmp/al-ummah-logs-$(date +%Y%m%d-%H%M%S)`
