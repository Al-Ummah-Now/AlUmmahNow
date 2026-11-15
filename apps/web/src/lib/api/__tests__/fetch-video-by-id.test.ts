/**
 * fetchVideoById maps the API's video into the watch page's PlayerOptions field by field, so a
 * field it leaves out never reaches the page (AUN-YT-IMPORT: the "Originally published on
 * YouTube" line reads importedFrom).
 */
import { fetchVideoById } from '../videos';
import { apiRequestServer } from '../api-client';

jest.mock('../api-client', () => ({
  apiRequestServer: jest.fn(),
  apiRequestServerResult: jest.fn(),
  buildApiUrl: jest.fn((path: string) => `https://api.example.com${path}`),
}));

jest.mock('../server-auth', () => ({
  getServerAuthContext: jest.fn(async () => null),
}));

jest.mock('@/lib/logger-server', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const base = {
  id: 'v1',
  title: 'Part 1',
  description: '',
  channelId: 'c1',
  channelName: 'Channel',
  userId: 'u1',
  dateCreated: '2026-11-14T10:40:00Z',
  publishedAt: '2026-11-14T10:40:00Z',
  views: 3,
  likes: [],
};

describe('fetchVideoById', () => {
  it('passes importedFrom through to the watch page', async () => {
    const importedFrom = { platform: 'youtube', videoId: 'dQw4w9WgXcQ', publishedAt: '2019-03-02T12:00:00Z', madeForKids: false, importId: 'imp1' };
    (apiRequestServer as jest.Mock).mockResolvedValue({ ...base, importedFrom });

    const options = await fetchVideoById('v1');

    expect(options?.importedFrom).toEqual(importedFrom);
  });

  it('sets importedFrom to null for a video uploaded here', async () => {
    (apiRequestServer as jest.Mock).mockResolvedValue(base);

    const options = await fetchVideoById('v1');

    expect(options?.id).toBe('v1');
    expect(options?.importedFrom).toBeNull();
  });
});
