/**
 * The feed list keeps every language's title and channel name: the related shelf tops up from it,
 * and on an Arabic page those rows read in English when the localized fields were dropped (#1513).
 */
jest.mock('../api-client', () => ({
  apiRequestServer: jest.fn(),
  apiRequestServerResult: jest.fn(),
  buildApiUrl: (path: string) => `https://api.test${path}`,
}));
jest.mock('../server-auth', () => ({ getServerAuthContext: async () => null }));

import { apiRequestServer } from '../api-client';
import { fetchVideos } from '../videos';

describe('fetchVideos', () => {
  it('keeps titleLocalized and channelNameLocalized', async () => {
    (apiRequestServer as jest.Mock).mockResolvedValue({
      cursor: null,
      data: [{
        id: 'v1', title: 'Eid morning in Istanbul', titleLocalized: { en: 'Eid morning in Istanbul', ar: 'صباح العيد في إسطنبول' },
        channelName: 'Bayt Al Hikma', channelNameLocalized: { en: 'Bayt Al Hikma', ar: 'بيت الحكمة' },
        dateCreated: '2026-11-01T00:00:00Z', dateModified: '2026-11-01T00:00:00Z', views: 3,
      }],
    });
    const [row] = (await fetchVideos(null)) ?? [];
    expect(row.titleLocalized).toEqual({ en: 'Eid morning in Istanbul', ar: 'صباح العيد في إسطنبول' });
    expect(row.channelNameLocalized).toEqual({ en: 'Bayt Al Hikma', ar: 'بيت الحكمة' });
  });

  it('leaves the fields out when the API has none', async () => {
    (apiRequestServer as jest.Mock).mockResolvedValue({ cursor: null, data: [{ id: 'v2', title: 'T', dateCreated: '2026-11-01T00:00:00Z', dateModified: '2026-11-01T00:00:00Z' }] });
    const [row] = (await fetchVideos(null)) ?? [];
    expect(row).not.toHaveProperty('titleLocalized');
    expect(row).not.toHaveProperty('channelNameLocalized');
  });
});
