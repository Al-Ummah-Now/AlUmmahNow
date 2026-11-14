import { activeChannelTab, loadChannelFirstTab } from '../first-tab';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { getChannelPlaylists, getChannelShorts, getChannelVideos } from '@/lib/api/channels';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';

jest.mock('@/lib/api/channel-tabs', () => ({ getChannelTabConfig: jest.fn() }));
jest.mock('@/lib/api/channels', () => ({ getChannelVideos: jest.fn(), getChannelShorts: jest.fn(), getChannelPlaylists: jest.fn() }));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));

const config = getChannelTabConfig as jest.Mock;
const videos = getChannelVideos as jest.Mock;
const shorts = getChannelShorts as jest.Mock;
const sections = listChannelSectionsPopulated as jest.Mock;
const playlists = getChannelPlaylists as jest.Mock;
const SIGNED = 'https://vz-1.b-cdn.net/v1/thumbnail.jpg?token=t&expires=1794603600';

describe('channel first tab (server-rendered channel page)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('should use ?tab= when it names a tab, else the default', () => {
    expect(activeChannelTab('videos', 'home')).toBe('videos');
    expect(activeChannelTab('nope', 'home')).toBe('home');
    expect(activeChannelTab(undefined, 'shorts')).toBe('shorts');
  });

  it('should read the Home tab sections for the default tab', async () => {
    config.mockResolvedValue(null);
    const filled = { id: 's1', type: 'recent_uploads', populatedContent: { videos: [{ id: 'v1', thumbnailUrl: SIGNED, views: 1 }] } };
    sections.mockResolvedValue([filled]);
    await expect(loadChannelFirstTab('c1', undefined)).resolves.toEqual({
      defaultTab: 'home',
      initial: { tab: 'home', sections: [{ ...filled, populatedContent: { videos: [{ id: 'v1', thumbnailUrl: '/thumb/v1.jpg', views: 1 }] } }] },
    });
    expect(videos).not.toHaveBeenCalled();
  });

  it('should read the Home sections beside the tab configuration, not after it', async () => {
    let releaseConfig: (v: unknown) => void = () => {};
    config.mockReturnValue(new Promise((r) => { releaseConfig = r; }));
    sections.mockResolvedValue([]);
    videos.mockResolvedValue({ data: [], cursor: '' });
    shorts.mockResolvedValue({ data: [], cursor: '' });
    playlists.mockResolvedValue({ data: [] });
    const pending = loadChannelFirstTab('c1', undefined);
    await Promise.resolve();
    await Promise.resolve();
    // The configuration has not answered yet, and the sections are already on their way
    expect(sections).toHaveBeenCalledWith('c1');
    releaseConfig(null);
    await expect(pending).resolves.toMatchObject({ defaultTab: 'home' });
    expect(sections).toHaveBeenCalledTimes(1);
  });

  it('should not read the Home sections early when ?tab= names another tab', async () => {
    config.mockResolvedValue({ defaultTab: 'home' });
    videos.mockResolvedValue({ data: [], cursor: '' });
    await loadChannelFirstTab('c1', 'videos');
    expect(sections).not.toHaveBeenCalled();
  });

  it('should give a Home tab without sections to show the channel uploads (#1206), with stable images', async () => {
    config.mockResolvedValue(null);
    sections.mockResolvedValue([{ id: 'empty', type: 'featured_videos', populatedContent: {} }]);
    videos.mockResolvedValue({ data: [{ id: 'v1', thumbnailUrl: SIGNED, views: 1 }, { id: 'v2', thumbnailUrl: SIGNED, views: 0, isPublic: false }], cursor: 'x' });
    shorts.mockResolvedValue({ data: [], cursor: '' });
    playlists.mockResolvedValue({ data: [{ id: 'p1', name: 'Public' }, { id: 'p2', name: 'Private', isPublic: false }] });
    const { initial } = await loadChannelFirstTab('c1', undefined);
    expect(initial?.fallback).toEqual({
      videos: [{ id: 'v1', thumbnailUrl: '/thumb/v1.jpg', views: 1 }, { id: 'v2', views: 0, isPublic: false }],
      shorts: [],
      playlists: [{ id: 'p1', name: 'Public' }],
    });
    // The private video's image was dropped: the tab reloads after hydration
    expect(initial?.partial).toBe(true);
    expect(JSON.stringify(initial)).not.toContain('token=');
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
