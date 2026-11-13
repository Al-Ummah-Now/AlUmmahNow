/**
 * The playlist page is server-rendered (wiki AUN-SEO, phase 4): with the server's copy the view
 * shows the title, channel link and items at once and does not fetch the playlist again.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PlaylistView from '../index';
import { getPlaylistById } from '@/lib/api/playlists';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock('@/lib/api/playlists', () => ({ getPlaylistById: jest.fn(), removeVideoFromPlaylist: jest.fn(), updatePlaylist: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const mockGet = getPlaylistById as jest.MockedFunction<typeof getPlaylistById>;

const playlist = {
  id: 'p1',
  title: 'Starter lectures',
  name: 'Starter lectures',
  channelId: 'c1',
  channelName: 'Lectures',
  userId: 'u1',
  isPublic: true,
  videos: ['v1', 'v2'],
  videoItems: [
    { id: 'v1', title: 'Tafsir', thumbnailUrl: 'https://cdn.example/v1.jpg' },
    { id: 'v2', title: 'Hadith', thumbnailUrl: 'https://cdn.example/v2.jpg' },
  ],
} as never;

describe('PlaylistView with the server copy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should render the title, channel link and item links without fetching', () => {
    render(<PlaylistView playlistId="p1" initialPlaylist={playlist} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Starter lectures' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lectures' })).toHaveAttribute('href', '/en/channels/c1');
    const items = screen.getAllByTestId('playlist-video-link');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('href')).toContain('/en/video/v1');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('should fetch the playlist when the server had none', async () => {
    mockGet.mockResolvedValue(playlist);
    render(<PlaylistView playlistId="p1" />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Starter lectures' })).toBeInTheDocument());
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
