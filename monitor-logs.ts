#!/usr/bin/env tsx
/**
 * Log Monitor - Continuously fetches and displays logs from the log service API
 *
 * Usage:
 *   tsx monitor-logs.ts                    # Monitor all apps
 *   tsx monitor-logs.ts web                # Monitor only web app
 *   tsx monitor-logs.ts web api-videos     # Monitor specific apps
 *   tsx monitor-logs.ts --level=error      # Only show error logs
 *   tsx monitor-logs.ts --tail=100         # Start with last 100 lines
 */

const LOG_SERVICE_URL = 'http://localhost:3089';
const POLL_INTERVAL_MS = 1000; // Check for new logs every second

interface LogLine {
  timestamp: string;
  level: string;
  app: string;
  message: string;
  rawLine: string;
}

// Parse command line arguments
const args = process.argv.slice(2);
const levelFilter = args.find(arg => arg.startsWith('--level='))?.split('=')[1];
const tailLines = args.find(arg => arg.startsWith('--tail='))?.split('=')[1];
const appsToMonitor = args.filter(arg => !arg.startsWith('--'));

// Track last seen line count for each app to detect new logs
const lastLineCount = new Map<string, number>();

// Color codes for different log levels
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};

function colorize(level: string, text: string): string {
  const levelUpper = level.toUpperCase();
  switch (levelUpper) {
    case 'ERROR':
      return `${colors.red}${text}${colors.reset}`;
    case 'WARN':
      return `${colors.yellow}${text}${colors.reset}`;
    case 'INFO':
      return `${colors.blue}${text}${colors.reset}`;
    case 'DEBUG':
      return `${colors.gray}${text}${colors.reset}`;
    default:
      return text;
  }
}

function formatLogLine(line: LogLine): string {
  const appName = `${colors.cyan}[${line.app}]${colors.reset}`;
  const timestamp = `${colors.gray}${line.timestamp}${colors.reset}`;
  const level = colorize(line.level, `[${line.level}]`);

  return `${timestamp} ${appName} ${level} ${line.message}`;
}

async function getAvailableApps(): Promise<string[]> {
  try {
    const response = await fetch(`${LOG_SERVICE_URL}/logs`);
    if (!response.ok) {
      throw new Error(`Failed to fetch log files: ${response.statusText}`);
    }
    const data = await response.json() as { files: string[] };
    return data.files.map(f => f.replace('.log', ''));
  } catch (error) {
    console.error(`${colors.red}Error fetching available apps:${colors.reset}`, error);
    return [];
  }
}

async function fetchLogs(appName: string, isInitial: boolean = false): Promise<LogLine[]> {
  try {
    const params = new URLSearchParams();

    if (levelFilter) {
      params.set('level', levelFilter);
    }

    if (isInitial && tailLines) {
      params.set('lines', tailLines);
      params.set('tail', 'true');
    }

    const url = `${LOG_SERVICE_URL}/logs/${appName}${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`Failed to fetch logs: ${response.statusText}`);
    }

    const data = await response.json() as { lines: string[], totalLines: number };

    // Parse log lines
    const logLines: LogLine[] = data.lines.map(line => {
      // Extract timestamp [2025-11-18T08:15:27.578Z]
      const timestampMatch = line.match(/\[([^\]]+)\]/);
      const timestamp = timestampMatch ? timestampMatch[1] : '';

      // Extract level [INFO], [ERROR], etc.
      const levelMatch = line.match(/\[([A-Z]+)\]/g);
      const level = levelMatch && levelMatch.length > 1 ? levelMatch[1].replace(/[\[\]]/g, '') : 'UNKNOWN';

      // Rest is the message
      const messageStart = line.indexOf(']', line.indexOf(']', line.indexOf(']') + 1) + 1) + 2;
      const message = line.substring(messageStart) || line;

      return {
        timestamp,
        level,
        app: appName,
        message,
        rawLine: line,
      };
    });

    return logLines;
  } catch (error) {
    console.error(`${colors.red}Error fetching logs for ${appName}:${colors.reset}`, error);
    return [];
  }
}

async function monitorApp(appName: string, isInitial: boolean = false) {
  const logs = await fetchLogs(appName, isInitial);

  if (logs.length === 0) {
    if (!lastLineCount.has(appName)) {
      lastLineCount.set(appName, 0);
    }
    return;
  }

  const previousCount = lastLineCount.get(appName) || 0;
  const currentCount = logs.length;

  if (isInitial) {
    // Initial load - show all fetched logs
    logs.forEach(log => console.log(formatLogLine(log)));
  } else if (currentCount > previousCount) {
    // New logs detected - show only new ones
    const newLogs = logs.slice(previousCount);
    newLogs.forEach(log => console.log(formatLogLine(log)));
  }

  lastLineCount.set(appName, currentCount);
}

async function monitorLogs() {
  // Get list of apps to monitor
  let apps = appsToMonitor.length > 0 ? appsToMonitor : await getAvailableApps();

  if (apps.length === 0) {
    console.log(`${colors.yellow}No log files found. Waiting for logs...${colors.reset}`);
    apps = ['web', 'api-videos', 'processor', 'websocket-server']; // Default apps
  }

  console.log(`${colors.green}📝 Monitoring logs for: ${apps.join(', ')}${colors.reset}`);
  if (levelFilter) {
    console.log(`${colors.green}🔍 Filter: level=${levelFilter}${colors.reset}`);
  }
  if (tailLines) {
    console.log(`${colors.green}📄 Starting with last ${tailLines} lines${colors.reset}`);
  }
  console.log(`${colors.gray}Press Ctrl+C to stop${colors.reset}\n`);

  // Initial fetch with tail option
  for (const app of apps) {
    await monitorApp(app, true);
  }

  // Poll for new logs
  setInterval(async () => {
    for (const app of apps) {
      await monitorApp(app, false);
    }
  }, POLL_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.green}Stopped monitoring logs${colors.reset}`);
  process.exit(0);
});

// Start monitoring
console.log(`${colors.cyan}Connecting to log service at ${LOG_SERVICE_URL}...${colors.reset}`);

// Check if log service is running
fetch(`${LOG_SERVICE_URL}/health`)
  .then(response => {
    if (!response.ok) {
      throw new Error('Log service not healthy');
    }
    return response.json();
  })
  .then(() => {
    console.log(`${colors.green}✅ Connected to log service${colors.reset}\n`);
    monitorLogs();
  })
  .catch(error => {
    console.error(`${colors.red}❌ Cannot connect to log service at ${LOG_SERVICE_URL}${colors.reset}`);
    console.error(`${colors.red}   Make sure the log service is running: cd apps/log-service && pnpm dev${colors.reset}`);
    console.error(`${colors.gray}   Error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
