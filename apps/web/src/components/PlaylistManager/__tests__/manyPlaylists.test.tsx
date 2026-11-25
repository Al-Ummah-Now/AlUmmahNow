/**
 * Manage Playlists listed the first 100 playlists and no more. It now pages
 * with "Show more playlists" and searches on the server.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlaylistManager from '../index';
import { listPlaylists } from '@/lib/api/playlists';
import { manyPlaylists, pagedList } from '@/components/playlists/__tests__/manyPlaylists';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, isRTL: false, lang: 'en' }),
}));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/components/PlaylistCover', () => ({ PlaylistCover: () => null }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-1') }));
jest.mock('@/lib/api/playlists', () => ({ listPlaylists: jest.fn(), deletePlaylist: jest.fn() }));

const mockList = listPlaylists as jest.MockedFunction<typeof listPlaylists>;
const ids = () => screen.queryAllByTestId('playlist-manager-item').map((el) => el.getAttribute('data-playlist-id'));

beforeEach(() => jest.clearAllMocks());

/**
 * Paging to #150 renders 160 rows four times: 2.3 to 3 s on a fast machine with nothing else running, and
 * it passed 5 s (jest's default) on a loaded CI runner (#1993's family). It is the test's own work, not
 * something it waits for, so it gets a budget that fits it.
 */
const PAGING_TIMEOUT_MS = 30_000;

it.each([
  ['personal playlists', '', { mine: true }],
  ['a channel\'s playlists', 'ch1', { channelId: 'ch1' }],
])('"Show more playlists" reaches #150 of %s', async (_label, channelId, scope) => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine', channelId)));
  render(<PlaylistManager channelId={channelId} />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  expect(ids()).not.toContain('Mine-150');
  while (screen.queryByRole('button', { name: 'Show more playlists' })) {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more playlists' })); });
  }
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ ...scope, cursor: '50' }));
  expect(ids()).toHaveLength(160);
}, PAGING_TIMEOUT_MS);

it('the search box finds #150 on the server', async () => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
  render(<PlaylistManager channelId="" />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search your playlists' }), { target: { value: 'Mine 150' } });
  // The search is debounced and then re-renders the list: a condition with a budget, over as soon as it holds
  await waitFor(() => expect(ids()).toEqual(['Mine-150']), { timeout: PAGING_TIMEOUT_MS });
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, q: 'Mine 150' }));
}, PAGING_TIMEOUT_MS);
