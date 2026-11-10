/**
 * The Home tab renders every section type from the content the API populated
 * (docs/specs/CHANNEL-SECTIONS.md §10), and only editors see sections without
 * content, with the reason and a way to fix it.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CHANNEL_SECTION_TYPES, type ChannelSectionType } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from '../ChannelSectionRenderer';
import { ChannelSections } from '../index';
import { pickSpotlightVideo } from '../shelves/SpotlightSection';
import { resolveSectionTitle, sectionLabelKey, type PopulatedChannelSection, type SectionContent } from '../sectionData';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { getChannelSubscriptionStatus } from '@/lib/api/channels';
import { ChannelViewerProvider } from '@/components/Channel/ChannelViewerContext';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
const mockUser = { current: null as null | { id: string } };
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));
jest.mock('@/lib/api/channels', () => ({ getChannelSubscriptionStatus: jest.fn() }));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/videoCard', () => ({
  __esModule: true,
  default: ({ id, title }: { id: string; title: string }) => <div data-testid="video-card">{`${id}:${title}`}</div>,
}));
jest.mock('@/components/live-streaming/LiveStreamCard', () => ({
  LiveStreamCard: ({ stream }: { stream: { id: string; status: string } }) => <div data-testid="live-card">{`${stream.id}:${stream.status}`}</div>,
}));
jest.mock('@/components/live-streaming/LiveStreamCard/rtl', () => ({ LiveStreamCardRTL: () => null }));

const mockList = listChannelSectionsPopulated as jest.MockedFunction<typeof listChannelSectionsPopulated>;
const mockStatus = getChannelSubscriptionStatus as jest.MockedFunction<typeof getChannelSubscriptionStatus>;

const CHANNEL = 'c1';
const video = (id: string, title = `Video ${id}`) => ({ id, title, thumbnailUrl: `https://img/${id}.jpg`, description: `About ${id}` }) as never;

function section(type: ChannelSectionType, populatedContent: SectionContent = {}, extra: Partial<PopulatedChannelSection> = {}): PopulatedChannelSection {
  return {
    id: `s-${type}`,
    channelId: CHANNEL,
    userId: 'u1',
    type,
    title: `${type} section`,
    position: 0,
    style: 'horizontal_row',
    itemCount: 12,
    showTimestamp: true,
    showChannelName: false,
    dateCreated: '2026-11-01T00:00:00.000Z',
    dateModified: '2026-11-01T00:00:00.000Z',
    populatedContent,
    isEmpty: false,
    ...extra,
  } as PopulatedChannelSection;
}

/** Content that fills each type, as the API returns it */
const FILLED: Record<ChannelSectionType, SectionContent> = {
  channel_spotlight: { spotlight: { trailer: video('t1', 'Welcome') } },
  featured_videos: { videos: [video('v1'), video('v2')] },
  recent_uploads: { videos: [video('v3')] },
  popular_uploads: { videos: [video('v4')] },
  shorts: { videos: [video('sh1')] },
  live_streams: { streams: [{ id: 'l1', title: 'Live now', channelId: CHANNEL, status: 'live' }] },
  liked_videos: { videos: [video('v5')] },
  single_playlist: { playlist: { id: 'p1', name: 'Tafsir course' }, videos: [video('v6')] },
  multiple_playlists: { playlists: [{ id: 'p2', name: 'Fiqh', videosCount: 4 }] },
  created_playlists: { playlists: [{ id: 'p3', name: 'Seerah', videosCount: 2 }] },
  featured_channels: { channels: [{ id: 'c2', name: 'Scholar', subscribersCount: 10, videosCount: 3 }] },
  subscribed_channels: { channels: [{ id: 'c3', name: 'Sister channel', subscribersCount: 5, videosCount: 1 }] },
  community_posts: {
    posts: [{ id: 'po1', channelId: CHANNEL, type: 'text', content: 'Jumuah reminder', likes: 3, comments: 1, pinned: true, createdAt: '2026-11-01T00:00:00.000Z' }],
  },
};

const KIND: Record<ChannelSectionType, string> = {
  channel_spotlight: 'spotlight', featured_videos: 'featured', recent_uploads: 'videos', popular_uploads: 'videos',
  shorts: 'shorts', live_streams: 'events', liked_videos: 'videos', single_playlist: 'playlist',
  multiple_playlists: 'playlists', created_playlists: 'playlists', featured_channels: 'channels',
  subscribed_channels: 'channels', community_posts: 'community',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.current = null;
});

describe('ChannelSectionRenderer: every type renders its populated content', () => {
  it.each(CHANNEL_SECTION_TYPES)('%s', (type) => {
    const { container } = render(<ChannelSectionRenderer section={section(type, FILLED[type])} channelId={CHANNEL} />);
    const root = container.querySelector('section');
    expect(root).toHaveAttribute('data-section', KIND[type]);
    // Default title (the stored "<type> section" counts as unset), except the spotlight and single playlist
    if (type === 'single_playlist') expect(screen.getByRole('heading', { name: 'Tafsir course' })).toBeInTheDocument();
    else if (type !== 'channel_spotlight') {
      expect(screen.getByRole('heading', { name: EN_TRANSLATIONS.channelSections.labels[type] })).toBeInTheDocument();
    }
  });

  it('renders video cards for video shelves in order', () => {
    render(<ChannelSectionRenderer section={section('featured_videos', FILLED.featured_videos)} channelId={CHANNEL} />);
    expect(screen.getAllByTestId('video-card').map((el) => el.textContent)).toEqual(['v1:Video v1', 'v2:Video v2']);
  });

  it('links playlist, channel, live and community content', () => {
    const { rerender } = render(<ChannelSectionRenderer section={section('multiple_playlists', FILLED.multiple_playlists)} channelId={CHANNEL} />);
    expect(screen.getByTestId('section-playlist-card')).toHaveAttribute('href', '/en/playlist/p2');
    expect(screen.getByText('4 videos')).toBeInTheDocument();

    rerender(<ChannelSectionRenderer section={section('featured_channels', FILLED.featured_channels)} channelId={CHANNEL} />);
    expect(screen.getByTestId('channel-tile')).toHaveAttribute('href', '/en/channels/c2');

    rerender(<ChannelSectionRenderer section={section('live_streams', FILLED.live_streams)} channelId={CHANNEL} />);
    expect(screen.getByTestId('live-card')).toHaveTextContent('l1:live');

    rerender(<ChannelSectionRenderer section={section('community_posts', FILLED.community_posts)} channelId={CHANNEL} />);
    const card = screen.getByTestId('section-post-card');
    expect(card).toHaveAttribute('href', '/en/channels/c1?tab=community');
    expect(card).toHaveTextContent('Jumuah reminder');
    expect(card).toHaveTextContent(EN_TRANSLATIONS.channelSections.render.pinned);
    expect(screen.getByText('3 likes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all posts/ })).toHaveAttribute('href', '/en/channels/c1?tab=community');
  });

  it('uses the owner title and the order-specific default for Shorts and past streams', () => {
    const { rerender } = render(
      <ChannelSectionRenderer section={section('featured_channels', FILLED.featured_channels, { title: 'Our scholars' })} channelId={CHANNEL} />
    );
    expect(screen.getByRole('heading', { name: 'Our scholars' })).toBeInTheDocument();
    rerender(<ChannelSectionRenderer section={section('shorts', FILLED.shorts, { sort: 'popular' })} channelId={CHANNEL} />);
    expect(screen.getByRole('heading', { name: 'Popular Shorts' })).toBeInTheDocument();
    rerender(<ChannelSectionRenderer section={section('live_streams', FILLED.live_streams, { liveFilter: 'past' })} channelId={CHANNEL} />);
    expect(screen.getByRole('heading', { name: 'Past live streams' })).toBeInTheDocument();
  });
});

describe('ChannelSectionRenderer: empty sections', () => {
  it.each(CHANNEL_SECTION_TYPES)('%s renders nothing for a visitor when empty', (type) => {
    const { container } = render(<ChannelSectionRenderer section={section(type, {}, { isEmpty: true })} channelId={CHANNEL} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(CHANNEL_SECTION_TYPES)('%s renders nothing for the owner either: the page looks the same to everyone', (type) => {
    for (const emptyHint of ['noContent', 'consentMissing', 'communityTabHidden', 'loadFailed'] as const) {
      const { container, unmount } = render(
        <ChannelSectionRenderer section={section(type, {}, { isEmpty: true, emptyHint, canEdit: true })} channelId={CHANNEL} />
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('Spotlight', () => {
  it('picks the trailer for visitors and the subscriber video for subscribers, falling back to the other', () => {
    const t = video('t'), r = video('r');
    expect(pickSpotlightVideo(t, r, false)).toEqual({ video: t, kind: 'trailer' });
    expect(pickSpotlightVideo(t, r, true)).toEqual({ video: r, kind: 'returning' });
    expect(pickSpotlightVideo(undefined, r, false)).toEqual({ video: r, kind: 'returning' });
    expect(pickSpotlightVideo(t, undefined, true)).toEqual({ video: t, kind: 'trailer' });
    expect(pickSpotlightVideo(undefined, undefined, true)).toBeNull();
  });

  it('shows signed-in subscribers the featured video for subscribers', async () => {
    mockUser.current = { id: 'viewer' };
    mockStatus.mockResolvedValue({ success: true, result: { channelId: CHANNEL, isSubscribed: true, subscriberCount: 1 } });
    render(
      <ChannelSectionRenderer
        section={section('channel_spotlight', { spotlight: { trailer: video('t1', 'Welcome'), returning: video('r1', 'New lesson') } })}
        channelId={CHANNEL}
      />
    );
    expect(screen.getByTestId('section-spotlight')).toHaveAttribute('data-spotlight-kind', 'trailer');
    await waitFor(() => expect(screen.getByTestId('section-spotlight')).toHaveAttribute('data-spotlight-kind', 'returning'));
    expect(screen.getByRole('heading', { name: 'New lesson' })).toBeInTheDocument();
    expect(screen.getByText(EN_TRANSLATIONS.channelSections.render.forSubscribers)).toBeInTheDocument();
  });

  it("doesn't ask for subscription status for visitors", () => {
    render(<ChannelSectionRenderer section={section('channel_spotlight', FILLED.channel_spotlight)} channelId={CHANNEL} />);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Watch/ })[0]).toHaveAttribute('href', '/en/video?vid=t1');
  });
});

describe('ChannelSections (Home tab)', () => {
  it('renders sections in the order the API returns', async () => {
    mockList.mockResolvedValue([section('recent_uploads', FILLED.recent_uploads), section('community_posts', FILLED.community_posts)] as never);
    const { container } = render(<ChannelSections channelId={CHANNEL} />);
    await screen.findByTestId('channel-sections');
    expect([...container.querySelectorAll('section[data-section-type]')].map((el) => el.getAttribute('data-section-type'))).toEqual([
      'recent_uploads',
      'community_posts',
    ]);
  });

  it('shows visitors nothing when loading fails', async () => {
    mockList.mockRejectedValue(new Error('down'));
    const { container } = render(<ChannelSections channelId={CHANNEL} />);
    await waitFor(() => expect(screen.queryByTestId('channel-sections-loading')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers editors a retry when loading fails', async () => {
    mockList.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([section('recent_uploads', FILLED.recent_uploads)] as never);
    render(
      <ChannelViewerProvider canEditLayout>
        <ChannelSections channelId={CHANNEL} />
      </ChannelViewerProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: EN_TRANSLATIONS.channelSections.retry }));
    expect(await screen.findByTestId('channel-sections')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});

describe('sectionData helpers', () => {
  it('treats generated titles as unset', () => {
    expect(resolveSectionTitle('recent_uploads section', 'Latest videos')).toBe('Latest videos');
    expect(resolveSectionTitle('  ', 'Latest videos')).toBe('Latest videos');
    expect(resolveSectionTitle('Our lessons', 'Latest videos')).toBe('Our lessons');
  });

  it('names Shorts and live sections by order and filter', () => {
    expect(sectionLabelKey({ type: 'shorts', sort: 'popular' })).toBe('shorts_popular');
    expect(sectionLabelKey({ type: 'live_streams', liveFilter: 'past' })).toBe('live_streams_past');
    expect(sectionLabelKey({ type: 'live_streams' })).toBe('live_streams');
  });
});
