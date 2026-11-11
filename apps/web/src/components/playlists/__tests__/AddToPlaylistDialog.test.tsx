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

const option = (name: string) => screen.getAllByTestId('add-to-playlist-option').find((o) => o.textContent?.includes(name))!;

it('adds the videos to every chosen playlist and shows each result', async () => {
  (addVideosToPlaylist as jest.Mock).mockImplementation(async (id: string) => (id === 'p1' ? { ok: true, data: { ...done(2), videosCount: 3 } } : { ok: false, status: 503 }));
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  expect(screen.getByText('Add 2 videos to playlists')).toBeInTheDocument();
  expect(screen.getByText('Search your playlists and choose one or more. Or start a new playlist with these videos.')).toBeInTheDocument();
  // The standard autocomplete, listing every playlist in place; no video picker here
  expect(await screen.findByRole('combobox', { name: 'Search your playlists' })).toBeInTheDocument();
  expect(screen.queryByTestId('video-picker')).toBeNull();
  fireEvent.click(option('Tafsir'));
  fireEvent.click(option('Fiqh'));
  expect(option('Tafsir')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('add-to-playlist-chosen')).toHaveTextContent('Tafsir');
  expect(screen.getByTestId('add-to-playlist-submit')).toHaveTextContent('Add to 2 playlists');
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('p1', ['a', 'b'], { channelId: 'ch' });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('p2', ['a', 'b'], { channelId: 'ch' });
  const results = screen.getByTestId('add-to-playlist-results');
  expect(within(results).getByText('Added 2 videos to Tafsir.')).toBeInTheDocument();
  expect(within(results).getByText("Couldn't add the videos to Fiqh. Please try again.")).toBeInTheDocument();
  // The option shows the playlist's count after the add (1 before, 3 now), and can't be chosen again
  expect(option('Tafsir')).toHaveTextContent('3 videos');
  expect(option('Tafsir')).toHaveAttribute('aria-disabled', 'true');
});

it('typing narrows the playlists, in either language', async () => {
  (listPlaylists as jest.Mock).mockResolvedValue({ data: [
    { id: 'p1', title: 'Tafsir', name: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: 'تفسير' }, videos: [], isPublic: true },
    { id: 'p2', title: 'Fiqh', name: 'Fiqh', videos: [], isPublic: true },
  ] });
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  const search = await screen.findByRole('combobox', { name: 'Search your playlists' });
  fireEvent.change(search, { target: { value: 'تفس' } });
  expect(screen.getAllByTestId('add-to-playlist-option').map((o) => o.getAttribute('data-option-id'))).toEqual(['p1']);
});

it('asks to choose a playlist first', async () => {
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  await screen.findAllByTestId('add-to-playlist-option');
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(screen.getByText('Choose a playlist first.')).toBeInTheDocument();
  expect(addVideosToPlaylist).not.toHaveBeenCalled();
});

it('New playlist: the create form with the selection (no picker), in order, and Back', async () => {
  const playlist = { id: 'p3', title: 'Seerah', name: 'Seerah', titleLocalized: { en: 'Seerah', ar: 'السيرة' }, videos: ['b', 'a'] };
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist, add: done(2) } });
  const onAdded = jest.fn();
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} onAdded={onAdded} />);
  await screen.findAllByTestId('add-to-playlist-option');
  expect(screen.getByTestId('add-to-playlist-new')).toHaveTextContent('New playlist with 2 videos');
  fireEvent.click(screen.getByTestId('add-to-playlist-new'));
  expect(screen.getByText('New playlist with 2 videos', { selector: 'h2' })).toBeInTheDocument();
  expect(screen.getByText('Name it and choose who can see it. The videos go in the order below.')).toBeInTheDocument();
  expect(screen.queryByTestId('video-picker')).toBeNull();
  expect(screen.getAllByTestId('create-order-row').map((r) => r.getAttribute('data-video-id'))).toEqual(['a', 'b']);
  // Back keeps nothing half-made
  fireEvent.click(screen.getByRole('button', { name: 'Back to playlists' }));
  expect(screen.getByText('Add 2 videos to playlists')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('add-to-playlist-new'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: 'Seerah' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (Arabic)' }), { target: { value: 'السيرة' } });
  fireEvent.click(screen.getByRole('radio', { name: /^Private/ }));
  fireEvent.click(within(screen.getAllByTestId('create-order-row')[0]).getByTestId('create-order-down'));
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({ title: 'Seerah', titleLocalized: { en: 'Seerah', ar: 'السيرة' }, isPublic: false, videoIds: ['b', 'a'], sortMode: 'manual' }), { channelId: 'ch' });
  expect(screen.getByText('Added 2 videos to Seerah.')).toBeInTheDocument();
  expect(onAdded).toHaveBeenCalled();
  // The new playlist joins the list
  expect(option('Seerah')).toBeInTheDocument();
});

it('opened with no videos: the create form with the video picker', async () => {
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={[]} />);
  expect(screen.getByText('New playlist', { selector: 'h2' })).toBeInTheDocument();
  expect(await screen.findByTestId('video-picker')).toBeInTheDocument();
  expect(screen.getByText('Videos (optional)')).toBeInTheDocument();
});

it('a queued add in the dialog shows background progress', async () => {
  (addVideosToPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { ...done(200), status: 'queued', pending: 100, jobId: 'j9' } });
  (getPlaylistAddJob as jest.Mock).mockResolvedValue({ ok: true, data: { id: 'j9', playlistId: 'p1', status: 'running', total: 100, processed: 40, added: 40, notInChannel: 0, updatedAt: '' } });
  render(<AddToPlaylistDialog open onOpenChange={jest.fn()} channelId="ch" videos={videos} />);
  await screen.findAllByTestId('add-to-playlist-option');
  fireEvent.click(option('Tafsir'));
  await act(async () => { fireEvent.click(screen.getByTestId('add-to-playlist-submit')); });
  expect(await screen.findByText('40 of 100 done')).toBeInTheDocument();
});
