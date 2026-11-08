/**
 * src/index.test.ts exercises the real HTTP API, so start the service once for
 * the test run and stop it afterwards.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const HEALTH_URL = 'http://localhost:3089/health';
const STARTUP_TIMEOUT_MS = 20_000;

let server: ChildProcess | undefined;

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`log-service did not become healthy at ${HEALTH_URL} within ${STARTUP_TIMEOUT_MS}ms`);
}

export async function setup(): Promise<void> {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { stdio: 'ignore' });
  await waitForHealth();
}

export async function teardown(): Promise<void> {
  server?.kill();
}
