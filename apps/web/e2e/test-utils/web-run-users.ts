import { runUserAddress, runUserEmail } from './run-users';

/**
 * The legacy suite's run users (auth.setup.ts): one set per CI job, named
 * web-<project>-<role>. E2E_PROJECT is the job's Playwright project
 * (e2e-tests.yml sets it), so jobs of one run never share accounts either.
 */
function webName(role: string): string {
  return `web-${process.env.E2E_PROJECT || 'local'}-${role}`;
}

/** Registers-to-be address, recorded for the run teardown. */
export function webRunUserEmail(role: string): string {
  return runUserEmail(webName(role));
}

/** Same address without recording it (specs that only sign in as the user). */
export function webRunUserAddress(role: string): string {
  return runUserAddress(webName(role));
}
