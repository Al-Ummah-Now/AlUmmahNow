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

// Pages of 3 (a cursor API may answer fewer than the 50 asked): rows are what a test here costs, 0.8 to
// 1 s for each page of 50 on the CI runner (all rows render again on every step), which put 160 of them
// past jest's 5 s under load. That 50 a page reaches #150 and on is usePlaylistPages' test, with no rows.
it.each([
  ['personal playlists', '', { mine: true }],
  ['a channel\'s playlists', 'ch1', { channelId: 'ch1' }],
])('"Show more playlists" reaches the last page of %s', async (_label, channelId, scope) => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine', channelId, 10), 3));
  render(<PlaylistManager channelId={channelId} />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  expect(ids()).not.toContain('Mine-10');
  // By test id, not by role: a role query computes the accessible name of every button on the page
  for (let more = screen.queryByTestId('playlist-manager-more'); more; more = screen.queryByTestId('playlist-manager-more')) {
    await act(async () => { fireEvent.click(more); });
  }
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ ...scope, limit: 50, cursor: '9' }));
  expect(ids()).toEqual(Array.from({ length: 10 }, (_, i) => `Mine-${i + 1}`));
});

it('the search box finds #150 on the server', async () => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine'), 3));
  render(<PlaylistManager channelId="" />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search your playlists' }), { target: { value: 'Mine 150' } });
  await waitFor(() => expect(ids()).toEqual(['Mine-150']));
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, q: 'Mine 150' }));
});
