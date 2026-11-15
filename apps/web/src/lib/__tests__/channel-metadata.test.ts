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

  it('no avatar or cover: the site\'s 1200x630 brand card, large preview', async () => {
    const meta = await buildChannelMetadata(channel(), 'en');
    expect(meta.openGraph?.images).toEqual([{ url: '/brand/og-default.jpg', width: 1200, height: 630, type: 'image/jpeg', alt: 'Test Channel' }]);
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: ['/brand/og-default.jpg'] });
  });

  it('an avatar: the channel\'s 1200x630 card (never the square avatar, which gets the small side preview)', async () => {
    const meta = await buildChannelMetadata(channel({ avatarUrl: 'https://cdn.example/a.jpg' } as Partial<Channel>), 'ar');
    const card = 'http://localhost:3001/og/c/ch_1.jpg';
    expect(meta.openGraph?.images).toEqual([{ url: card, secureUrl: card, width: 1200, height: 630, type: 'image/jpeg', alt: 'Test Channel' }]);
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', images: [card] });
  });

  it('only a cover banner: still the channel\'s card', async () => {
    const meta = await buildChannelMetadata(channel({ coverUrl: 'https://cdn.example/c.jpg' } as Partial<Channel>), 'en');
    expect(meta.twitter?.images).toEqual(['http://localhost:3001/og/c/ch_1.jpg']);
  });
});
