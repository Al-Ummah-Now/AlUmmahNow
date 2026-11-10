/**
 * The Channels tab lists the channels a channel features: the channels the
 * API populated for featured-channel and (consented) subscription sections.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ChannelsTabContent, loadFeaturedChannels } from '../ChannelsTabContent';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
jest.mock('@/lib/api/channel-sections', () => ({ listChannelSectionsPopulated: jest.fn() }));

const mockList = listChannelSectionsPopulated as jest.MockedFunction<typeof listChannelSectionsPopulated>;
const CHANNEL_ID = 'self';
const channel = (id: string, name: string) => ({ id, name, subscribersCount: 1, videosCount: 1 });

beforeEach(() => jest.clearAllMocks());

it('merges populated channels in section order, without itself or duplicates', async () => {
  mockList.mockResolvedValue([
    { id: 's1', type: 'featured_channels', populatedContent: { channels: [channel('a', 'Alpha'), channel(CHANNEL_ID, 'Me')] } },
    { id: 's2', type: 'subscribed_channels', populatedContent: { channels: [channel('a', 'Alpha dup'), channel('p', 'Pop')] } },
    { id: 's3', type: 'recent_uploads', populatedContent: { videos: [] } },
  ] as never);
  expect((await loadFeaturedChannels(CHANNEL_ID)).map((c) => c.id)).toEqual(['a', 'p']);
});

it('renders tiles for featured channels', async () => {
  mockList.mockResolvedValue([{ id: 's1', type: 'featured_channels', populatedContent: { channels: [channel('a', 'Alpha')] } }] as never);
  render(<ChannelsTabContent channelId={CHANNEL_ID} />);
  await waitFor(() => expect(screen.getAllByTestId('channel-tile')).toHaveLength(1));
});

it('renders an empty state when the channel features no channels', async () => {
  mockList.mockResolvedValue([] as never);
  render(<ChannelsTabContent channelId={CHANNEL_ID} />);
  expect(await screen.findByText(EN_TRANSLATIONS.discovery.channelsTabEmpty)).toBeInTheDocument();
});
