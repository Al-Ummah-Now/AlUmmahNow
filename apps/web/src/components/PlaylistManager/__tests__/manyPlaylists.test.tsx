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

const lapsFrom = () => {
  let t0 = performance.now();
  return (what: string) => { process.stdout.write(`LAP ${what} ${(performance.now() - t0).toFixed(0)}ms\n`); t0 = performance.now(); };
};
const fileStart = performance.now();

beforeEach(() => jest.clearAllMocks());

it.each([
  ['personal playlists', '', { mine: true }],
  ['a channel\'s playlists', 'ch1', { channelId: 'ch1' }],
])('"Show more playlists" reaches #150 of %s', async (_label, channelId, scope) => {
  process.stdout.write(`LAP test starts ${(performance.now() - fileStart).toFixed(0)}ms after the file loaded\n`);
  const lap = lapsFrom();
  mockList.mockImplementation(pagedList(manyPlaylists('Mine', channelId)));
  render(<PlaylistManager channelId={channelId} />);
  lap('render');
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  lap('first page');
  expect(ids()).not.toContain('Mine-150');
  // By test id, not by role: a role query computes the accessible name of every button among 160 rows,
  // which is most of what this test cost
  for (let more = screen.queryByTestId('playlist-manager-more'); more; more = screen.queryByTestId('playlist-manager-more')) {
    await act(async () => { fireEvent.click(more); });
    lap('more');
  }
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ ...scope, cursor: '50' }));
  lap('called');
  expect(ids()).toHaveLength(160);
  lap('length');
});

it('the search box finds #150 on the server', async () => {
  const lap = lapsFrom();
  mockList.mockImplementation(pagedList(manyPlaylists('Mine')));
  render(<PlaylistManager channelId="" />);
  await waitFor(() => expect(ids()).toContain('Mine-1'));
  lap('search: first page');
  const box = screen.getByRole('searchbox', { name: 'Search your playlists' });
  lap('search: role query for the box');
  fireEvent.change(box, { target: { value: 'Mine 150' } });
  await waitFor(() => expect(ids()).toEqual(['Mine-150']));
  lap('search: result');
  expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ mine: true, q: 'Mine 150' }));
});
