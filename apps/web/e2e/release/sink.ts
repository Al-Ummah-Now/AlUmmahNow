/**
 * Auth server test routes for the release suite: the E2E code sink and admin
 * promotion. Both exist on QA and stage only and need X-E2E-Secret.
 */
import { readSinkCode as readFromSink } from '../test-utils/code-sink';
import { readResendCode } from './resend-code';
import { releaseEnv, target } from './targets';

/** The email code for `email`: the E2E sink on QA/stage, the Resend API on production. */
export function readSinkCode(email: string, timeoutMs = 20000, sentAfter = Date.now() - 60000): Promise<string> {
  if (releaseEnv() === 'production') return readResendCode(email, sentAfter, Math.max(timeoutMs, 60000));
  return readFromSink(target().auth, email, timeoutMs);
}

/**
 * Gives a registered user the auth server's admin role (POST /test/promote).
 * The role is in tokens issued afterwards, so sign in again after this.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  const promoteSecret = process.env.TEST_PROMOTE_SECRET;
  if (!promoteSecret) throw new Error('TEST_PROMOTE_SECRET is not set');
  const res = await fetch(`${target().auth}/test/promote/${encodeURIComponent(email)}`, {
    method: 'POST',
    headers: { 'X-Test-Secret': promoteSecret, 'X-E2E-Secret': process.env.E2E_CODE_SINK_SECRET ?? '' },
  });
  if (!res.ok) throw new Error(`promoting ${email} to admin failed: ${res.status} ${await res.text()}`);
}
