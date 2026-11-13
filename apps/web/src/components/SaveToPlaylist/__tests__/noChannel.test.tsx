/**
 * Playlists without a channel (owner request 2026-11-13): a signed-in user
 * with no active channel saves to their personal playlists. The dialog used
 * to say "a channel is required" and offer nothing.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveToPlaylist from '../index';
import { addVideoToPlaylist, createPlaylist, listPlaylists, removeVideoFromPlaylist } from '@/lib/api/playlists';

let mockChannel: { id: string } | null = null;
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, isRTL: false, lang: 'en' }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'usr_1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useCurrentChannel: () => mockChannel }));
jest.mock('@/lib/api/playlists', () => ({
  listPlaylists: jest.fn(),
  createPlaylist: jest.fn(),
  addVideoToPlaylist: jest.fn(),
  removeVideoFromPlaylist: jest.fn(),
}));

const mockList = listPlaylists as jest.MockedFunction<typeof listPlaylists>;
const mockCreate = createPlaylist as jest.MockedFunction<typeof createPlaylist>;
const mockAdd = addVideoToPlaylist as jest.MockedFunction<typeof addVideoToPlaylist>;
const mockRemove = removeVideoFromPlaylist as jest.MockedFunction<typeof removeVideoFromPlaylist>;

beforeEach(() => {
  jest.clearAllMocks();
  mockChannel = null;
});

describe('SaveToPlaylist without a channel', () => {
  it('lists the personal playlists and toggles the video in them, with no channel header', async () => {
    mockList.mockResolvedValue({ data: [{ id: 'pl_me', name: 'Mine', title: 'Mine', channelId: '', videos: [] }] } as never);
    mockAdd.mockResolvedValue({ success: true } as never);
    mockRemove.mockResolvedValue({ success: true } as never);
    const { container } = render(<SaveToPlaylist videoId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByRole('dialog');
    expect(mockList).toHaveBeenCalledWith({ mine: true, limit: 50 });
    expect(screen.queryByText(/channel/i)).toBeNull();

    const box = await waitFor(() => container.querySelector('[data-playlist-id="pl_me"] input[type="checkbox"]') as HTMLInputElement);
    await act(async () => { fireEvent.click(box); });
    expect(mockAdd).toHaveBeenCalledWith('pl_me', { videoId: 'v1' }, { channelId: '' });
    await waitFor(() => expect(box.checked).toBe(true));
    await act(async () => { fireEvent.click(box); });
    expect(mockRemove).toHaveBeenCalledWith('pl_me', 'v1', { channelId: '' });
  });

  it('creates a personal playlist with the video in it', async () => {
    mockList.mockResolvedValue({ data: [] } as never);
    mockCreate.mockResolvedValue({ success: true, result: { playlist: { id: 'pl_new', name: 'Fresh', title: 'Fresh', channelId: '' } } } as never);
    mockAdd.mockResolvedValue({ success: true } as never);
    const { container } = render(<SaveToPlaylist videoId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="text"], input:not([type])')!, { target: { value: 'Fresh' } });
    await act(async () => { fireEvent.submit(dialog.querySelector('form')!); });
    expect(mockCreate).toHaveBeenCalledWith({ name: 'Fresh', isPublic: true }, { channelId: '' });
    expect(mockAdd).toHaveBeenCalledWith('pl_new', { videoId: 'v1' }, { channelId: '' });
    await waitFor(() => expect(container.querySelector('[data-playlist-id="pl_new"]')).not.toBeNull());
  });

  it('with a channel active it lists and creates the channel\'s playlists, as before', async () => {
    mockChannel = { id: 'ch1' };
    mockList.mockResolvedValue({ data: [] } as never);
    render(<SaveToPlaylist videoId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByRole('dialog');
    expect(mockList).toHaveBeenCalledWith({ channelId: 'ch1', limit: 50 });
  });

  it('opens from outside (the card menu) without its own button', async () => {
    mockList.mockResolvedValue({ data: [] } as never);
    const onOpenChange = jest.fn();
    render(<SaveToPlaylist videoId="v1" open onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('button', { name: /^save to playlist$/i })).toBeNull();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
