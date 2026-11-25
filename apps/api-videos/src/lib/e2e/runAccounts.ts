/** E2E run accounts (test data), known by their address: the auth server's rule, and apps/web/e2e/test-utils/run-users.ts's. */
export const RUN_USER_EMAIL = /^e2e\+\d{1,20}-\d{1,3}-[a-z0-9][a-z0-9-]{0,62}@e2e\.alummahnow\.net$/;

export function isRunUserEmail(email: unknown): email is string {
	return typeof email === 'string' && RUN_USER_EMAIL.test(email.toLowerCase());
}

type RunEnv = { BUNNY_TEST_LIBRARY?: unknown; ENVIRONMENT?: unknown };

/** Only a non-production worker on a test library has run accounts. */
export function hasRunAccounts(env: RunEnv): boolean {
	return env.BUNNY_TEST_LIBRARY === 'true' && String(env.ENVIRONMENT ?? '').toLowerCase() !== 'production';
}

/** A run account of this environment. */
export function isRunAccount(env: RunEnv, email: unknown): boolean {
	return hasRunAccounts(env) && isRunUserEmail(email);
}
