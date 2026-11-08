/**
 * Reads a verification code from the auth server's E2E code sink. Addresses at
 * @e2e.alummahnow.net get their codes stored instead of emailed on QA and
 * stage; production has no sink and answers 404. Used by the release suite and
 * the legacy suite's user registration (auth.setup.ts).
 */
export const SINK_DOMAIN = 'e2e.alummahnow.net';

export async function readSinkCode(authUrl: string, email: string, timeoutMs = 20000): Promise<string> {
  const secret = process.env.E2E_CODE_SINK_SECRET;
  if (!secret) throw new Error('E2E_CODE_SINK_SECRET is not set');
  const url = `${authUrl.replace(/\/$/, '')}/test/email/${encodeURIComponent(email)}?consume=1`;
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
