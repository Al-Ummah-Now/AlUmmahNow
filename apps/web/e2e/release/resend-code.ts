import { fetchRetry } from './net';
/**
 * Reads the auth server's verification code for a Resend test address
 * (…@delivered.resend.dev) through the Resend API (RESEND_API_KEY): production
 * has no E2E code sink. Same lookup as release-prod/signed-in.check.ts.
 * Never logs the key or the code.
 */
export async function readResendCode(email: string, sentAfter: number, timeoutMs = 60000): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is required to read codes on production');
  const auth = { Authorization: `Bearer ${key}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetchRetry('https://api.resend.com/emails?limit=50', { headers: auth });
    if (res.ok) {
      const list = (await res.json()) as { data?: { id: string; to: string[] | string; created_at: string }[] };
      const hit = (list.data ?? []).find(
        (e) => [e.to].flat().includes(email) && Date.parse(e.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= sentAfter - 5000,
      );
      if (hit) {
        const mail = (await (await fetchRetry(`https://api.resend.com/emails/${hit.id}`, { headers: auth })).json()) as { html?: string; text?: string };
        const code = `${mail.text ?? ''} ${(mail.html ?? '').replace(/<[^>]+>/g, ' ')}`.match(/\b(\d{6})\b/)?.[1];
        if (code) return code;
      }
    }
    // Resend allows 2 requests/s per key; other jobs may share it
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`no verification email for ${email} in Resend within ${timeoutMs / 1000}s`);
}
