/**
 * Channel page metadata: the canonical uses the same origin rule as every page (originFromHost), and a
 * channel without an avatar still has a share image (its openGraph replaces the root layout's).
 */
jest.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'localhost:3001'], ['x-forwarded-proto', 'https']]),
}));

import type { Channel } from '@al-ummah/shared-types';
import { buildChannelMetadata } from '../channel-metadata';

const channel = (extra: Partial<Channel> = {}) => ({ id: 'ch_1', name: 'Test Channel', handle: 'testchannel', description: '', ...extra }) as unknown as Channel;

describe('buildChannelMetadata', () => {
  it('canonical on the request host by originFromHost (http for localhost, whatever x-forwarded-proto says)', async () => {
    const meta = await buildChannelMetadata(channel(), 'en');
    expect(String(meta.alternates?.canonical)).toMatch(/^http:\/\/localhost:3001\/en\//);
  });

  it('no avatar: the site share image, with its size', async () => {
    const meta = await buildChannelMetadata(channel(), 'en');
    expect(meta.openGraph?.images).toEqual([{ url: '/icon-512.png', width: 512, height: 512, alt: 'Test Channel' }]);
    expect(meta.twitter?.images).toEqual(['/icon-512.png']);
  });

  it('an avatar: the channel avatar', async () => {
    const meta = await buildChannelMetadata(channel({ avatarUrl: 'https://cdn.example/a.jpg' } as Partial<Channel>), 'ar');
    expect(meta.openGraph?.images).toEqual([{ url: 'https://cdn.example/a.jpg', alt: 'Test Channel' }]);
    expect(meta.twitter?.images).toEqual(['https://cdn.example/a.jpg']);
  });
});
