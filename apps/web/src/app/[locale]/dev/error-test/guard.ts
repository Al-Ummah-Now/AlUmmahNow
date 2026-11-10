const ALLOWED = new Set(['qa', 'stage', 'staging', 'preview', 'development']);

/** The error-test page exists only outside production (NEXTJS_ENV is a Worker var). */
export function errorTestAllowed(env: string | undefined): boolean {
  return !!env && ALLOWED.has(env);
}
