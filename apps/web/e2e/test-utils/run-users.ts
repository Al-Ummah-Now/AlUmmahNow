/**
 * Per-run E2E accounts: every CI E2E job registers its own users and deletes them
 * when it ends, so concurrent runs never share accounts (no shared pinned users,
 * no job-level concurrency queue).
 *
 *   e2e+<run id>-<attempt>-<name>@e2e.alummahnow.net
 *
 * E2E_RUN_ID=<github.run_id>-<github.run_attempt> turns run mode on (the workflows
 * set it). <name> is free text the suite picks, e.g. web-chromium-single or
 * admin-webkit-admin; keep it unique per job. Registering such an address on QA or
 * stage marks the account as a run account (AlUmmahNowAuth utils/e2e-sink.ts), and
 * only marked accounts can be deleted by the teardown route
 * (AlUmmahNowAuth routes/test-run-users.ts, POST /test/run-users/delete/:email).
 *
 * Every address a suite generates is appended to E2E_RUN_USERS_FILE (one per line)
 * before it is registered, so the teardown (scripts/e2e/teardown-run-users.ts,
 * an `if: always()` step) deletes it even when the job is cancelled half-way.
 * Anything a crashed runner never got to delete is removed by the sweeper
 * (.github/workflows/e2e-run-users-sweep.yml) once it is 24 hours old.
 *
 * Plain Node, no imports but node:fs (the release suite copies this file next to
 * code-sink.ts and runs without the monorepo): used by apps/web/e2e, apps/admin-web/e2e,
 * the release suite and the teardown script.
 */
import { appendFileSync } from 'node:fs';

export const RUN_USER_DOMAIN = 'e2e.alummahnow.net';
/** Same rule as the auth server's RUN_USER_EMAIL (AlUmmahNowAuth utils/e2e-sink.ts). */
export const RUN_USER_EMAIL = /^e2e\+\d{1,20}-\d{1,3}-[a-z0-9][a-z0-9-]{0,62}@e2e\.alummahnow\.net$/;
const RUN_ID = /^\d{1,20}-\d{1,3}$/;

export function isRunUserEmail(email: string): boolean {
  return RUN_USER_EMAIL.test(email);
}

/** `<run id>-<attempt>` when this process runs in run mode, else null. */
export function runId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = (env.E2E_RUN_ID ?? '').trim();
  if (!id) return null;
  if (!RUN_ID.test(id)) throw new Error(`E2E_RUN_ID must look like <run id>-<attempt>, got ${JSON.stringify(id)}`);
  return id;
}

/** Lowercase letters, digits and dashes; at most 63 characters, never empty. */
export function runUserName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
  if (!clean) throw new Error(`run user name ${JSON.stringify(name)} has no usable characters`);
  return clean;
}

/**
 * The run account address for `name`, recorded in E2E_RUN_USERS_FILE. Throws
 * outside run mode: callers decide what their non-CI fallback is.
 */
export function runUserEmail(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const email = runUserAddress(name, env);
  recordRunUser(email, env);
  return email;
}

/** The address runUserEmail gives `name`, without recording it (for code that only signs in). */
export function runUserAddress(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const id = runId(env);
  if (!id) throw new Error('runUserEmail needs E2E_RUN_ID (run mode)');
  const email = `e2e+${id}-${runUserName(name)}@${RUN_USER_DOMAIN}`;
  if (!isRunUserEmail(email)) throw new Error(`generated run address ${email} does not match the run-user rule`);
  return email;
}

/** Appends `email` to E2E_RUN_USERS_FILE (when set), before the account exists. */
export function recordRunUser(email: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.E2E_RUN_USERS_FILE;
  if (file) appendFileSync(file, `${email}\n`);
}

/** Unique run addresses in a recorded file's text (other lines are ignored). */
export function parseRunUsers(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.trim().toLowerCase()).filter(isRunUserEmail))];
}
