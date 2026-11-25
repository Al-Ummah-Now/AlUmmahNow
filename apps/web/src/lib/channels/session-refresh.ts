import type { getActiveSessionInfo } from '@/lib/actions/multi-account';

export type ActiveSessionInfo = Awaited<ReturnType<typeof getActiveSessionInfo>>;

/** Updates the session cookie's channel cache (POST /api/session/channels); the page is not rendered again. */
export async function refreshSessionChannels(): Promise<ActiveSessionInfo> {
  const response = await fetch('/api/session/channels', { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error(`Session channels not refreshed (${response.status})`);
  return ((await response.json()) as { session: ActiveSessionInfo }).session;
}
