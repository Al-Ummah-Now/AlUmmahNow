/**
 * A playlist created in the dialog stays listed when the dialog's initial list load (which can take
 * seconds on a large channel, #909) lands after it. Before, the late load replaced the list and the
 * new playlist vanished until the dialog was reopened (E2E WATCH-014).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveToPlaylist from '../index';
import { addVideoToPlaylist, createPlaylist, listPlaylists } from '@/lib/api/playlists';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, isRTL: false, lang: 'en' }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'usr_1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useCurrentChannel: () => ({ id: 'ch1' }) }));
jest.mock('@/lib/api/playlists', () => ({
  listPlaylists: jest.fn(),
  createPlaylist: jest.fn(),
  addVideoToPlaylist: jest.fn(),
  removeVideoFromPlaylist: jest.fn(),
}));

const mockList = listPlaylists as jest.MockedFunction<typeof listPlaylists>;
const mockCreate = createPlaylist as jest.MockedFunction<typeof createPlaylist>;
const mockAdd = addVideoToPlaylist as jest.MockedFunction<typeof addVideoToPlaylist>;

describe('SaveToPlaylist: create while the list is loading', () => {
  it('shows the new playlist at once and keeps it when the slower list load lands', async () => {
    let finishList!: (v: unknown) => void;
    mockList.mockReturnValueOnce(new Promise((r) => { finishList = r; }) as never);
    mockCreate.mockResolvedValueOnce({ success: true, result: { playlist: { id: 'pl_new', name: 'Fresh', title: 'Fresh' } } } as never);
    mockAdd.mockResolvedValueOnce({ success: true } as never);

    const { container } = render(<SaveToPlaylist videoId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type="text"], input:not([type])')!, { target: { value: 'Fresh' } });
    fireEvent.submit(dialog.querySelector('form')!);

    // Listed while the initial load is still pending
    await waitFor(() => expect(container.querySelector('[data-playlist-id="pl_new"]')).not.toBeNull());

    // The load started before the create lands without it: the new playlist stays
    await act(async () => { finishList({ data: [{ id: 'pl_old', name: 'Old', title: 'Old', videos: [] }] }); });
    expect(container.querySelector('[data-playlist-id="pl_new"]')).not.toBeNull();
    expect(container.querySelector('[data-playlist-id="pl_old"]')).not.toBeNull();
  });
});
