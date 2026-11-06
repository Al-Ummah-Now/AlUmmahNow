/**
 * CI logger for the QA seed script.
 *
 * Follows the ciLogger pattern from e2e/auth.setup.ts: the web app's
 * @/lib/logger-client filters 'info' outside development, which hides the
 * progress output we need in GitHub Actions logs. Output is line-oriented and
 * deterministic (no timestamps inside the message) so runs can be diffed.
 */

const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

function format(data: unknown): string {
  if (data === undefined) return '';
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ' [unserializable]';
  }
}

export const seedLogger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO] ${message}${format(data)}`);
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[WARN] ${message}${format(data)}`);
    if (isGithubActions) console.log(`::warning::${message.replace(/\r?\n/g, ' ')}`);
  },
  error: (message: string, data?: unknown) => {
    console.error(`[ERROR] ${message}${format(data)}`);
    if (isGithubActions) console.log(`::error::${message.replace(/\r?\n/g, ' ')}`);
  },
  debug: (message: string, data?: unknown) => {
    if (process.env.DEBUG) console.log(`[DEBUG] ${message}${format(data)}`);
  },
  group: (title: string) => {
    if (isGithubActions) console.log(`::group::${title}`);
    else console.log(`\n=== ${title} ===`);
  },
  groupEnd: () => {
    if (isGithubActions) console.log('::endgroup::');
  },
};

/**
 * Registers a value with the GitHub Actions log masker so it is replaced by
 * *** if it is ever printed. No-op outside GitHub Actions.
 */
export function maskSecret(value: string | undefined): void {
  if (!value || !isGithubActions) return;
  console.log(`::add-mask::${value}`);
}
