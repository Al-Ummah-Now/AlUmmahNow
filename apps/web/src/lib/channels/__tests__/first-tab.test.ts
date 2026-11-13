import { activeChannelTab, loadChannelFirstTab } from '../first-tab';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { getChannelShorts, getChannelVideos } from '@/lib/api/channels';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';

jest.mock('@/lib/api/channel-tabs', () => ({ getChannelTabConfig: jest.fn() }));
jest.mock('@/lib/api/channels', () => ({ getChannelVideos: jest.fn(), getChannelShorts: jest.fn() }));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));

const config = getChannelTabConfig as jest.Mock;
const videos = getChannelVideos as jest.Mock;
const shorts = getChannelShorts as jest.Mock;
const sections = listChannelSectionsPopulated as jest.Mock;

describe('channel first tab (server-rendered channel page)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('should use ?tab= when it names a tab, else the default', () => {
    expect(activeChannelTab('videos', 'home')).toBe('videos');
    expect(activeChannelTab('nope', 'home')).toBe('home');
    expect(activeChannelTab(undefined, 'shorts')).toBe('shorts');
  });

  it('should read the Home tab sections for the default tab', async () => {
    config.mockResolvedValue(null);
    sections.mockResolvedValue([{ id: 's1' }]);
    await expect(loadChannelFirstTab('c1', undefined)).resolves.toEqual({ defaultTab: 'home', initial: { tab: 'home', sections: [{ id: 's1' }] } });
  });

  it('should read the first page of the Videos or Shorts tab', async () => {
    config.mockResolvedValue({ defaultTab: 'videos' });
    videos.mockResolvedValue({ data: [{ id: 'v1' }], cursor: 'c2' });
    shorts.mockResolvedValue({ data: [{ id: 's1' }], cursor: '' });
    await expect(loadChannelFirstTab('c1', undefined)).resolves.toEqual({ defaultTab: 'videos', initial: { tab: 'videos', page: { data: [{ id: 'v1' }], cursor: 'c2' } } });
    expect(videos).toHaveBeenCalledWith('c1', { limit: 24 });
    await expect(loadChannelFirstTab('c1', 'shorts')).resolves.toMatchObject({ initial: { tab: 'shorts' } });
  });

  it('should leave the data to the client when the API fails or for other tabs', async () => {
    config.mockRejectedValue(new Error('down'));
    sections.mockRejectedValue(new Error('down'));
    await expect(loadChannelFirstTab('c1', undefined)).resolves.toEqual({ defaultTab: 'home', initial: undefined });
    await expect(loadChannelFirstTab('c1', 'about')).resolves.toEqual({ defaultTab: 'home' });
  });
});
