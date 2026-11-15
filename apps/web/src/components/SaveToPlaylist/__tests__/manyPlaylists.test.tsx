/**
 * "Save to playlist" with more playlists than one page: it listed the first 50
 * and the rest were out of reach. Now "Show more" pages on and the search box
 * asks the server, so playlist #150 can be found and ticked either way.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveToPlaylist from '../index';
import { addVideoToPlaylist, createPlaylist, listPlaylists } from '@/lib/api/playlists';
import { manyPlaylists, pagedList } from '@/components/playlists/__tests__/manyPlaylists';

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
const mockAdd = addVideoToPlaylist as jest.MockedFunction<typeof addVideoToPlaylist>;
const mockCreate = createPlaylist as jest.MockedFunction<typeof createPlaylist>;

beforeEach(() => {
  jest.clearAllMocks();
  mockChannel = null;
  mockAdd.mockResolvedValue({ success: true } as never);
});

const row = (container: HTMLElement, id: string) => container.querySelector(`[data-playlist-id="${id}"]`);

async function openMenu() {
  const view = render(<SaveToPlaylist videoId="v1" />);
  fireEvent.click(screen.getByTestId('save-to-playlist-button'));
  await screen.findByRole('dialog');
  await waitFor(() => expect(row(view.container, 'Mine-1')).not.toBeNull());
  return view;
}

describe('SaveToPlaylist with more playlists than one page', () => {
  it('reaches personal playlist #150 with "Show more" and ticks it', async () => {
    mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
    const { container } = await openMenu();
    expect(row(container, 'Mine-150')).toBeNull();
    while (screen.queryByRole('button', { name: 'Show more playlists' })) {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more playlists' })); });
    }
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, cursor: '50' }));
    // Every page is listed once
    expect(container.querySelectorAll('[data-playlist-id]')).toHaveLength(160);
    expect(screen.queryByRole('button', { name: 'Show more playlists' })).toBeNull();
    const box = row(container, 'Mine-150')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { fireEvent.click(box); });
    expect(mockAdd).toHaveBeenCalledWith('Mine-150', { videoId: 'v1' }, { channelId: '' });
  });

  it('finds playlist #150 by searching the server', async () => {
    mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
    const { container } = await openMenu();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your playlists' }), { target: { value: 'Mine 150' } });
    await waitFor(() => expect(row(container, 'Mine-150')).not.toBeNull());
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, q: 'Mine 150' }));
    expect(container.querySelectorAll('[data-playlist-id]')).toHaveLength(1);
    await act(async () => { fireEvent.click(row(container, 'Mine-150')!.querySelector('input[type="checkbox"]')!); });
    expect(mockAdd).toHaveBeenCalledWith('Mine-150', { videoId: 'v1' }, { channelId: '' });
  });

  it('says when nothing matches', async () => {
    mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
    await openMenu();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your playlists' }), { target: { value: 'nothing like it' } });
    expect(await screen.findByText('No playlists match your search.')).toBeInTheDocument();
  });

  it('pages a channel\'s playlists the same way', async () => {
    mockChannel = { id: 'ch1' };
    mockList.mockImplementation(pagedList(manyPlaylists('Mine', 'ch1')));
    const { container } = await openMenu();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more playlists' })); });
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'ch1', cursor: '50' }));
    expect(row(container, 'Mine-100')).not.toBeNull();
  });

  it('a playlist created here stays on top while more pages load', async () => {
    mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
    mockCreate.mockResolvedValue({ success: true, result: { playlist: { id: 'pl_new', name: 'Fresh', title: 'Fresh', channelId: '' } } } as never);
    const { container } = await openMenu();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="text"]')!, { target: { value: 'Fresh' } });
    await act(async () => { fireEvent.submit(screen.getByTestId('save-to-playlist-create')); });
    await waitFor(() => expect(row(container, 'pl_new')).not.toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more playlists' })); });
    const ids = [...container.querySelectorAll('[data-playlist-id]')].map((el) => el.getAttribute('data-playlist-id'));
    expect(ids[0]).toBe('pl_new');
    expect(ids).toContain('Mine-100');
    expect((row(container, 'pl_new')!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });
});
