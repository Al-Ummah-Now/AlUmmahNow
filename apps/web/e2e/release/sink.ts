/**
 * Reads a verification code from the auth server's E2E code sink (QA and stage
 * only; production has no sink and answers 404). The secret comes from CI.
 */
import { target } from './targets';

export async function readSinkCode(email: string, timeoutMs = 20000): Promise<string> {
  const secret = process.env.E2E_CODE_SINK_SECRET;
  if (!secret) throw new Error('E2E_CODE_SINK_SECRET is not set');
  const url = `${target().auth}/test/email/${encodeURIComponent(email)}?consume=1`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers: { 'X-E2E-Secret': secret } });
    if (res.ok) {
      const body = (await res.json()) as { code?: string };
      if (body.code) return body.code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no verification code for ${email} in the sink within ${timeoutMs / 1000}s`);
}
