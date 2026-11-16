jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/api/server-auth', () => ({ getServerAuthContext: jest.fn() }));
jest.mock('@/lib/api/api-client', () => ({ buildApiUrl: (path: string) => `https://api.test${path}` }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { getServerAuthContext } from '@/lib/api/server-auth';
import { NO_FEATURES } from '@al-ummah/shared-types';
import { loadFeatures } from '../server';

const auth = getServerAuthContext as jest.Mock;
const ok = (features: Record<string, unknown>) => jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, version: 1, features }) }));

describe('getFeatures (server)', () => {
  it('reads the channel\'s features with the session token', async () => {
    auth.mockResolvedValue({ userId: 'u1', accessToken: 'tok' });
    const f = ok({ live: true });
    const features = await loadFeatures('ch1', f as unknown as typeof fetch);
    expect(features.live).toBe(true);
    expect(features.upload).toBe(false);
    expect(f).toHaveBeenCalledWith('https://api.test/api/me/features?channelId=ch1', expect.objectContaining({ headers: { Authorization: 'Bearer tok' }, cache: 'no-store' }));
  });

  it('fails closed when the API cannot answer', async () => {
    auth.mockResolvedValue(null);
    expect(await loadFeatures(null, (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch)).toEqual(NO_FEATURES);
    expect(await loadFeatures(null, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).toEqual(NO_FEATURES);
  });
});
