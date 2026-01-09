# Al Ummah Log MCP Server

An MCP (Model Context Protocol) server that provides tools for watching and querying logs from the Al Ummah Now log service.

## Tools

### `get_logs`
Get recent logs from all apps or a specific app.

**Parameters:**
- `app` (optional): Filter by app name (e.g., "admin-api", "api-videos", "web")
- `level` (optional): Filter by log level (debug, info, warn, error)
- `lines` (optional): Number of log lines to return (default: 50, max: 500)
- `tail` (optional): If true, return most recent logs first (default: true)

### `watch_logs`
Watch logs in real-time for a specified duration.

**Parameters:**
- `app` (optional): Filter by app name
- `level` (optional): Filter by log level
- `duration` (optional): How long to watch in seconds (default: 5, max: 30)

### `search_logs`
Search logs for specific text patterns.

**Parameters:**
- `query` (required): Text pattern to search for
- `app` (optional): Filter by app name
- `level` (optional): Filter by log level
- `lines` (optional): Max matching lines to return (default: 100)

### `list_log_apps`
List all available app names that have log files.

## Configuration

The server connects to the log service at `http://localhost:3089` by default.
Set `LOG_SERVICE_URL` environment variable to override.

## Usage with Claude Code

The project includes `.mcp.json` configuration. Restart Claude Code to load the MCP server.

## Manual Build

```bash
cd packages/mcp-log-server
pnpm install
pnpm build
```

## Manual Run

```bash
node dist/index.js
```
