/**
 * Tests for channel discovery sections (live events, featured channels, subscriptions)
 * and the Channels tab.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { UpcomingEventsSection } from '../types/UpcomingEventsSection';
import { CompletedEventsSection } from '../types/CompletedEventsSection';
import { MultipleChannelsSection } from '../types/MultipleChannelsSection';
import { SubscriptionsSection } from '../types/SubscriptionsSection';
import { ChannelsTabContent, loadFeaturedChannels } from '@/components/ChannelTabs/ChannelsTabContent';
import {
  extractLiveStreams,
  getSectionChannelIds,
  toLiveStreamCardModel,
  type PopulatedChannelSection,
} from '../sectionData';
import { listLiveStreams } from '@/lib/api/livestreams';
import { getChannelById } from '@/lib/api/channels';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="next-image">{alt}</span>,
}));

jest.mock('@/components/live-streaming/LiveStreamCard', () => ({
  LiveStreamCard: ({ stream }: { stream: { title: string } }) => (
    <div data-testid="live-stream-card">{stream.title}</div>
  ),
  LiveStreamCardSkeleton: () => <div data-testid="live-stream-skeleton" />,
}));

jest.mock('@/components/live-streaming/LiveStreamCard/rtl', () => ({
  LiveStreamCardRTL: ({ stream }: { stream: { title: string } }) => (
    <div data-testid="live-stream-card-rtl">{stream.title}</div>
  ),
}));

jest.mock('@/lib/api/livestreams', () => ({ listLiveStreams: jest.fn() }));
jest.mock('@/lib/api/channels', () => ({ getChannelById: jest.fn() }));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));

const mockListLiveStreams = listLiveStreams as jest.MockedFunction<typeof listLiveStreams>;
const mockGetChannelById = getChannelById as jest.MockedFunction<typeof getChannelById>;
const mockListSections = listChannelSectionsPopulated as jest.MockedFunction<typeof listChannelSectionsPopulated>;

const CHANNEL_ID = 'c0000000-0000-4000-8000-000000000001';

function channel(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, userId: 'u', email: 'e@x.com', isMain: false, dateCreated: '', dateModified: '', ...extra };
}

describe('sectionData helpers', () => {
  it('extracts streams from the API result envelope and the legacy data envelope', () => {
    const stream = { id: 's1', title: 'A', channelId: CHANNEL_ID, status: 'live' };
    expect(extractLiveStreams({ success: true, result: { data: [stream] } })).toEqual([stream]);
    expect(extractLiveStreams({ success: true, data: { data: [stream] } })).toEqual([stream]);
    expect(extractLiveStreams(null)).toEqual([]);
  });

  it('reads channel ids from flat and nested (view model) sections', () => {
    expect(getSectionChannelIds({ channelIds: ['a'] } as PopulatedChannelSection)).toEqual(['a']);
    expect(getSectionChannelIds({ content: { channelIds: ['b'] } } as PopulatedChannelSection)).toEqual(['b']);
    expect(getSectionChannelIds({} as PopulatedChannelSection)).toEqual([]);
  });

  it('maps API streams to card models with a fallback thumbnail', () => {
    const card = toLiveStreamCardModel({
      id: 's1',
      title: 'Talk',
      channelId: CHANNEL_ID,
      status: 'cancelled',
      actualStartTime: '2026-01-01T10:00:00Z',
    });
    expect(card.status).toBe('ended');
    expect(card.thumbnailUrl).toBe('/brand/logo-320.webp');
    expect(card.channel.id).toBe(CHANNEL_ID);
    expect(card.startedAt).toBeInstanceOf(Date);
  });
});

describe('Live event sections', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests scheduled streams for the channel and renders them soonest first', async () => {
    mockListLiveStreams.mockResolvedValue({
      success: true,
      result: {
        data: [
          { id: 's2', title: 'Later', channelId: CHANNEL_ID, status: 'scheduled', scheduledStartTime: '2030-01-02T00:00:00Z' },
          { id: 's1', title: 'Sooner', channelId: CHANNEL_ID, status: 'scheduled', scheduledStartTime: '2030-01-01T00:00:00Z' },
          { id: 's3', title: 'Other channel', channelId: 'other', status: 'scheduled' },
        ],
      },
    } as never);

    render(<UpcomingEventsSection channelId={CHANNEL_ID} />);

    const cards = await screen.findAllByTestId('live-stream-card');
    expect(cards.map((c) => c.textContent)).toEqual(['Sooner', 'Later']);
    expect(mockListLiveStreams).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'scheduled', channelId: CHANNEL_ID })
    );
    expect(screen.getByText(EN_TRANSLATIONS.channel.upcomingLiveStreams)).toBeInTheDocument();
  });

  it('shows a localized empty state when the channel has no past streams', async () => {
    mockListLiveStreams.mockResolvedValue({ success: true, result: { data: [] } } as never);

    render(<CompletedEventsSection channelId={CHANNEL_ID} />);

    expect(await screen.findByText(EN_TRANSLATIONS.discovery.completedEventsEmpty)).toBeInTheDocument();
    expect(mockListLiveStreams).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended' }));
  });
});

describe('MultipleChannelsSection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders visible configured channels and skips private ones', async () => {
    mockGetChannelById.mockImplementation(async (id: string) => {
      if (id === 'a') return channel('a', 'Alpha') as never;
      if (id === 'b') return channel('b', 'Beta', { isPrivate: true }) as never;
      return null;
    });

    render(<MultipleChannelsSection title="Friends" channelIds={['a', 'b', 'missing']} />);

    const tiles = await screen.findAllByTestId('channel-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute('href', '/en/channels/a');
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('shows the empty state without fetching when no channels are configured', () => {
    render(<MultipleChannelsSection channelIds={[]} />);
    expect(screen.getByText(EN_TRANSLATIONS.discovery.featuredChannelsEmpty)).toBeInTheDocument();
    expect(mockGetChannelById).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsSection', () => {
  it('renders populated subscriptions', () => {
    render(
      <SubscriptionsSection
        channelId={CHANNEL_ID}
        channels={[{ id: 'x', name: 'Xray', subscribersCount: 1200, videosCount: 3 }]}
      />
    );
    expect(screen.getByTestId('channel-tile')).toHaveAttribute('href', '/en/channels/x');
    expect(screen.getByText('1.2K subscribers')).toBeInTheDocument();
  });

  it('shows the private/empty state when nothing is exposed', () => {
    render(<SubscriptionsSection channelId={CHANNEL_ID} channels={[]} />);
    expect(screen.getByText(EN_TRANSLATIONS.discovery.subscriptionsEmpty)).toBeInTheDocument();
  });
});

describe('ChannelsTabContent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('merges configured and populated section channels, excluding self and duplicates', async () => {
    mockListSections.mockResolvedValue([
      { id: 's1', position: 0, channelIds: ['a', CHANNEL_ID] },
      { id: 's2', position: 1, populatedContent: { channels: [{ id: 'a', name: 'Alpha dup' }, { id: 'p', name: 'Pop' }] } },
    ] as never);
    mockGetChannelById.mockImplementation(async (id: string) => channel(id, id === 'a' ? 'Alpha' : id) as never);

    const result = await loadFeaturedChannels(CHANNEL_ID);
    expect(result.map((c) => c.id)).toEqual(['a', 'p']);
    expect(mockGetChannelById).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state when the channel features no channels', async () => {
    mockListSections.mockResolvedValue([] as never);
    render(<ChannelsTabContent channelId={CHANNEL_ID} />);
    expect(await screen.findByText(EN_TRANSLATIONS.discovery.channelsTabEmpty)).toBeInTheDocument();
  });

  it('renders tiles for featured channels', async () => {
    mockListSections.mockResolvedValue([{ id: 's1', position: 0, channelIds: ['a'] }] as never);
    mockGetChannelById.mockResolvedValue(channel('a', 'Alpha') as never);
    render(<ChannelsTabContent channelId={CHANNEL_ID} />);
    await waitFor(() => expect(screen.getAllByTestId('channel-tile')).toHaveLength(1));
  });
});
