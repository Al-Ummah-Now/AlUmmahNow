import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AddToPlaylistDialog from '../AddToPlaylistDialog';
import { addVideosToPlaylist, createManagedPlaylist, getPlaylistAddJob, listPlaylists } from '@/lib/api/playlists';
import { listVideos } from '@/lib/api/videos';
import { video } from './testUtils';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/playlists', () => ({
  addVideosToPlaylist: jest.fn(), createManagedPlaylist: jest.fn(), listPlaylists: jest.fn(), getPlaylistAddJob: jest.fn(), retryPlaylistAddJob: jest.fn(),
}));
jest.mock('@/lib/api/videos', () => ({ listVideos: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-3') }));

const videos = [{ id: 'a', title: 'Lesson a' }, { id: 'b', title: 'Lesson b' }];
const done = (added: number) => ({ status: 'done', added, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: added });

beforeEach(() => {
  jest.clearAllMocks();
  (listPlaylists as jest.Mock).mockResolvedValue({ data: [
    { id: 'p1', title: 'Tafsir', name: 'Tafsir', videos: ['x'], isPublic: true },
    { id: 'p2', title: 'Fiqh', name: 'Fiqh', videos: [], isPublic: false },
  ] });
  (listVideos as jest.Mock).mockResolvedValue({ data: [video('a'), video('b')], cursor: null });
});

it('adds the videos to every chosen playlist and shows each result', async () => {
  (addVideosToPlaylist as jest.Mock).mockImplementation(async (id: string) => (id === 'p1' ? { ok: true, data: done(2) } : { ok: false, status: 503 }));
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  expect(screen.getByText('Add 2 videos to playlists')).toBeInTheDocument();
  const options = await screen.findAllByTestId('add-to-playlist-option');
  fireEvent.click(options[0]);
  fireEvent.click(options[1]);
  expect(screen.getByTestId('add-to-playlist-submit')).toHaveTextContent('Add to 2 playlists');
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('p1', ['a', 'b'], { channelId: 'ch' });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('p2', ['a', 'b'], { channelId: 'ch' });
  const results = screen.getByTestId('add-to-playlist-results');
  expect(within(results).getByText('Added 2 videos to Tafsir.')).toBeInTheDocument();
  expect(within(results).getByText("Couldn't add the videos to Fiqh. Please try again.")).toBeInTheDocument();
  // Done playlists can't be chosen again
  expect(screen.getAllByTestId('add-to-playlist-option')[0]).toBeDisabled();
});

it('asks to choose a playlist first', async () => {
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  await screen.findAllByTestId('add-to-playlist-option');
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(screen.getByText('Choose a playlist first.')).toBeInTheDocument();
  expect(addVideosToPlaylist).not.toHaveBeenCalled();
});

it('creates a playlist inline with the chosen videos (picker included) and reports the result', async () => {
  const playlist = { id: 'p3', title: 'Seerah', name: 'Seerah', videos: ['a', 'b'] };
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist, add: done(2) } });
  const onAdded = jest.fn();
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} onAdded={onAdded} />);
  await screen.findAllByTestId('add-to-playlist-option');
  fireEvent.click(screen.getByTestId('add-to-playlist-new'));
  expect(screen.getAllByTestId('picker-tray-item')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Seerah' } });
  fireEvent.click(screen.getByRole('radio', { name: /^Private/ }));
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({ title: 'Seerah', isPublic: false, videoIds: ['a', 'b'], sortMode: 'manual' }), { channelId: 'ch' });
  expect(screen.getByText('Added 2 videos to Seerah.')).toBeInTheDocument();
  expect(onAdded).toHaveBeenCalled();
  // The new playlist joins the list
  expect(screen.getByText('Seerah')).toBeInTheDocument();
});

it('a queued add in the dialog shows background progress', async () => {
  (addVideosToPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { ...done(200), status: 'queued', pending: 100, jobId: 'j9' } });
  (getPlaylistAddJob as jest.Mock).mockResolvedValue({ ok: true, data: { id: 'j9', playlistId: 'p1', status: 'running', total: 100, processed: 40, added: 40, notInChannel: 0, updatedAt: '' } });
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  fireEvent.click((await screen.findAllByTestId('add-to-playlist-option'))[0]);
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(await screen.findByText('40 of 100 done')).toBeInTheDocument();
});
