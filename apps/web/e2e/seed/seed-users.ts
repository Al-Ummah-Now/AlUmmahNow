import { ApiClient } from './seed-api';
import type { SessionTokens } from './seed-auth';
import { seedLogger as log } from './seed-logger';

/**
 * Idempotent profile / channel provisioning for a logged-in user, shared by
 * the E2E auth setup (e2e/auth.setup.ts).
 */

export interface UserChannelSpec {
  name: string;
  description?: string;
  isMain?: boolean;
}

interface ChannelRecord {
  id: string;
  name: string;
  userId: string;
  isMain?: boolean;
  isDeleted?: boolean;
  dateCreated?: string;
}

/** Creates the user's profile (id = token subject) if it does not exist. Returns true if created. */
export async function ensureProfile(
  api: ApiClient,
  session: SessionTokens,
  profile: { email: string; displayName: string },
): Promise<boolean> {
  const existing = await api.get(`/api/profiles/${encodeURIComponent(session.userId)}`, {
    token: session.accessToken,
    allowStatus: [404],
  });
  if (existing.status !== 404) return false;
  await api.post(
    '/api/profiles',
    {
      email: profile.email,
      userName: profile.email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '_'),
      displayName: profile.displayName,
      timezone: 'UTC',
    },
    { token: session.accessToken },
  );
  log.info('Profile created', { email: profile.email, userId: session.userId });
  return true;
}

/**
 * Deletes the caller's profile if it has one (DELETE /api/profile only removes
 * the profile record). Returns true when there was none to delete.
 */
export async function ensureNoProfile(api: ApiClient, session: SessionTokens): Promise<boolean> {
  const existing = await api.get(`/api/profiles/${encodeURIComponent(session.userId)}`, {
    token: session.accessToken,
    allowStatus: [404],
  });
  if (existing.status === 404) return true;
  await api.request('/api/profile', { method: 'DELETE', token: session.accessToken, allowStatus: [404] });
  log.info('Profile deleted', { userId: session.userId });
  return false;
}

/**
 * Lists the caller's own channels. GET /api/channels filters to the caller's
 * channels when authenticated but returns an empty cursor for any page with
 * no matches, so a single large page is requested.
 */
export async function listOwnChannels(api: ApiClient, session: SessionTokens): Promise<ChannelRecord[]> {
  const res = await api.get<{ data?: ChannelRecord[] }>('/api/channels?limit=1000', { token: session.accessToken });
  return (res.data.data || []).filter((c) => c.userId === session.userId && !c.isDeleted);
}

/**
 * Ensures each named channel exists for the user (matched by name). Extra
 * channels are left untouched and reported.
 */
export async function ensureChannels(
  api: ApiClient,
  session: SessionTokens,
  specs: UserChannelSpec[],
): Promise<{ channels: ChannelRecord[]; created: string[]; extra: string[] }> {
  const existing = await listOwnChannels(api, session);
  const created: string[] = [];
  const result: ChannelRecord[] = [];
  for (const spec of specs) {
    const found = existing.find((c) => c.name === spec.name);
    if (found) {
      result.push(found);
      continue;
    }
    const res = await api.post<{ result?: { channel?: ChannelRecord } }>(
      '/api/channels',
      { name: spec.name, description: spec.description, isMain: spec.isMain ?? false },
      { token: session.accessToken },
    );
    const channel = res.data.result?.channel;
    if (!channel?.id) throw new Error(`Channel create for "${spec.name}" returned no id`);
    created.push(spec.name);
    result.push(channel);
  }
  const wanted = new Set(specs.map((s) => s.name));
  const extra = existing.filter((c) => !wanted.has(c.name)).map((c) => c.name);
  return { channels: result, created, extra };
}

/**
 * Name prefixes of the throwaway channels specs create (21-channel-handles-owner,
 * 09-channel-switching). Specs delete them when they finish, but a cancelled or
 * crashed run leaves them behind, and a leftover channel changes what the
 * account menu, profile and "active channel" show for that user.
 */
export const DISPOSABLE_CHANNEL_PREFIXES = ['E2E Temp Channel', 'قناة اختبار'];

/**
 * Deletes the user's leftover throwaway channels (matched by name prefix and
 * created at least `minAgeMs` ago, so a run still using one is left alone).
 * Never touches the channels in `keep`. Returns the deleted channel names.
 */
export async function purgeDisposableChannels(
  api: ApiClient,
  session: SessionTokens,
  opts: { keep: string[]; minAgeMs: number },
): Promise<string[]> {
  const keep = new Set(opts.keep);
  const cutoff = Date.now() - opts.minAgeMs;
  const stale = (await listOwnChannels(api, session)).filter(
    (c) =>
      !keep.has(c.name) &&
      !c.isMain &&
      DISPOSABLE_CHANNEL_PREFIXES.some((p) => c.name.startsWith(p)) &&
      new Date(c.dateCreated || 0).getTime() <= cutoff,
  );
  const deleted: string[] = [];
  for (const channel of stale) {
    const res = await api.request(`/api/channels/${channel.id}`, {
      method: 'DELETE',
      token: session.accessToken,
      channelId: channel.id,
      allowStatus: [403, 404],
    });
    if (res.status < 300) deleted.push(channel.name);
    else log.warn('Could not delete leftover channel', { name: channel.name, status: res.status });
  }
  return deleted;
}
