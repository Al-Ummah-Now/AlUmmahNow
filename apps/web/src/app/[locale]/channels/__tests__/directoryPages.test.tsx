/**
 * Tests for the /{locale}/channels and /{locale}/videos browse pages
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { ChannelsPageClient } from '../ChannelsPageClient';
import { VideosPageClient, getNextVideosCursor } from '../../videos/VideosPageClient';
import { listDirectoryChannels } from '@/lib/api/channels';
import { fetchVideosWithPagination } from '@/lib/api/videos';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

jest.mock('@/components/videoCard/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/components/videoCard/rtl/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card-rtl">{title}</div>,
}));

jest.mock('@/lib/api/channels', () => ({ listDirectoryChannels: jest.fn() }));
// Signed-out viewer: no owner actions on the directory cards
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: null }) }));
jest.mock('@/components/Channel/ChannelOwnerActions', () => ({ ChannelOwnerActions: () => null }));
jest.mock('@/lib/api/videos', () => ({ fetchVideosWithPagination: jest.fn() }));

const mockListChannels = listDirectoryChannels as jest.MockedFunction<typeof listDirectoryChannels>;
const mockFetchVideos = fetchVideosWithPagination as jest.MockedFunction<typeof fetchVideosWithPagination>;

function channel(id: string, name: string) {
  return { id, name, userId: 'u', email: 'e@x.com', isMain: false, dateCreated: '', dateModified: '', createdAt: '' };
}

describe('ChannelsPageClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists channels and loads the next page with the cursor', async () => {
    mockListChannels
      .mockResolvedValueOnce({ data: [channel('a', 'Alpha')], cursor: 'next-1' })
      .mockResolvedValueOnce({ data: [channel('b', 'Beta')], cursor: '' });

    render(<ChannelsPageClient />);

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.common.loadMore }));

    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(mockListChannels).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-1' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: EN_TRANSLATIONS.common.loadMore })).not.toBeInTheDocument()
    );
  });

  it('shows an empty state', async () => {
    mockListChannels.mockResolvedValue({ data: [], cursor: '' });
    render(<ChannelsPageClient />);
    expect(await screen.findByText(EN_TRANSLATIONS.discovery.noChannels)).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    mockListChannels.mockResolvedValue(null);
    render(<ChannelsPageClient />);
    expect(await screen.findByText(EN_TRANSLATIONS.discovery.loadFailed)).toBeInTheDocument();
  });
});

describe('VideosPageClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the next cursor from either response shape', () => {
    expect(getNextVideosCursor({ cursor: 'abc', data: [] })).toBe('abc');
    expect(getNextVideosCursor({ data: [], pagination: { nextCursor: 'xyz', hasMore: true } })).toBe('xyz');
    expect(getNextVideosCursor({ cursor: '', data: [] })).toBeNull();
  });

  it('renders videos with a load more button', async () => {
    mockFetchVideos.mockResolvedValue({ data: [{ id: 'v1', title: 'First video' }], cursor: 'c1' } as never);
    render(<VideosPageClient />);
    expect(await screen.findByText('First video')).toBeInTheDocument();
    expect(screen.getByText(EN_TRANSLATIONS.discovery.allVideos)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN_TRANSLATIONS.common.loadMore })).toBeInTheDocument();
  });
});
