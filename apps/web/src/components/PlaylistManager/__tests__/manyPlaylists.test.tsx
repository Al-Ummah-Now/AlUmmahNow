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

it.each([
  ['personal playlists', '', { mine: true }],
  ['a channel\'s playlists', 'ch1', { channelId: 'ch1' }],
])('"Show more playlists" reaches #150 of %s', async (_label, channelId, scope) => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine', channelId)));
  render(<PlaylistManager channelId={channelId} />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  expect(ids()).not.toContain('Mine-150');
  // By test id, not by role: a role query computes the accessible name of every button among 160 rows,
  // which is most of what this test cost
  for (let more = screen.queryByTestId('playlist-manager-more'); more; more = screen.queryByTestId('playlist-manager-more')) {
    await act(async () => { fireEvent.click(more); });
  }
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ ...scope, cursor: '50' }));
  expect(ids()).toHaveLength(160);
});

it('the search box finds #150 on the server', async () => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
  render(<PlaylistManager channelId="" />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search your playlists' }), { target: { value: 'Mine 150' } });
  await waitFor(() => expect(ids()).toEqual(['Mine-150']));
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, q: 'Mine 150' }));
});
