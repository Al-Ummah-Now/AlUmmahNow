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
