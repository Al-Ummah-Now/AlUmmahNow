import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import CreatePlaylistForm from '../CreatePlaylistForm';
import { createManagedPlaylist } from '@/lib/api/playlists';
import { listVideos } from '@/lib/api/videos';
import { reportError } from '@/lib/errors/reporter';
import { video } from './testUtils';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/playlists', () => ({ createManagedPlaylist: jest.fn() }));
jest.mock('@/lib/api/videos', () => ({ listVideos: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-2') }));

beforeEach(() => {
  jest.clearAllMocks();
  (listVideos as jest.Mock).mockResolvedValue({ data: [video('a'), video('b'), video('c')], cursor: null });
});

it('creates with the name, order and the picked videos in pick order, in one request', async () => {
  const playlist = { id: 'new', title: 'Tafsir', name: 'Tafsir', videos: ['c', 'a'] };
  const add = { status: 'done', added: 2, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 2 };
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist, add } });
  const onCreated = jest.fn();
  render(<CreatePlaylistForm channelId="ch" onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Tafsir ' } });
  fireEvent.click(screen.getByRole('radio', { name: /Automatic/ }));
  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'title' } });
  const rows = await screen.findAllByTestId('picker-video');
  fireEvent.click(within(rows[2]).getByRole('checkbox'));
  fireEvent.click(within(rows[0]).getByRole('checkbox'));
  expect(screen.getByTestId('create-playlist-submit')).toHaveTextContent('Create with 2 videos');
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Tafsir', isPublic: true, sortMode: 'auto', sortField: 'title', sortDirection: 'desc', videoIds: ['c', 'a'],
  }), { channelId: 'ch' });
  expect(onCreated).toHaveBeenCalledWith({ playlist, videoIds: ['c', 'a'], add });
});

it('a blank name is refused before any request', async () => {
  render(<CreatePlaylistForm channelId="ch" onCreated={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Please enter a playlist name');
  expect(createManagedPlaylist).not.toHaveBeenCalled();
});

it('a playlist that was not created: friendly words with a reference, reported', async () => {
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  const onCreated = jest.fn();
  render(<CreatePlaylistForm channelId="ch" onCreated={onCreated} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tafsir' } });
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Could not create the playlist. Please try again.');
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Reference: ref-2');
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ shown: true, status: 500 }));
  expect(onCreated).not.toHaveBeenCalled();
});

it('inline (compact): no description, starts from the given videos', async () => {
  render(<CreatePlaylistForm channelId="ch" compact initialVideos={[{ id: 'b', title: 'Lesson b' }]} onCreated={jest.fn()} />);
  expect(screen.queryByLabelText('Description')).toBeNull();
  expect(await screen.findByTestId('picker-tray-item')).toHaveTextContent('Lesson b');
  expect(screen.getByTestId('create-playlist-submit')).toHaveTextContent('Create with 1 video');
});
