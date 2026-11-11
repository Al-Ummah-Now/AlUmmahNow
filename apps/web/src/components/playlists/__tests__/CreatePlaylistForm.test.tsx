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
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: '  Tafsir ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (Arabic)' }), { target: { value: 'تفسير' } });
  fireEvent.click(screen.getByRole('radio', { name: /Automatic/ }));
  fireEvent.change(screen.getByTestId('sort-field'), { target: { value: 'title' } });
  const rows = await screen.findAllByTestId('picker-video');
  fireEvent.click(within(rows[2]).getByRole('checkbox'));
  fireEvent.click(within(rows[0]).getByRole('checkbox'));
  expect(screen.getByTestId('create-playlist-submit')).toHaveTextContent('Create with 2 videos');
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: 'تفسير' }, isPublic: true, sortMode: 'auto', sortField: 'title', sortDirection: 'desc', videoIds: ['c', 'a'],
  }), { channelId: 'ch' });
  expect(onCreated).toHaveBeenCalledWith({ playlist, videoIds: ['c', 'a'], add });
});

it('a blank name (both languages) is refused before any request', async () => {
  render(<CreatePlaylistForm channelId="ch" onCreated={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: '   ' } });
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Enter a name in English or Arabic.');
  expect(createManagedPlaylist).not.toHaveBeenCalled();
});

it('a playlist that was not created: friendly words with a reference, reported', async () => {
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  const onCreated = jest.fn();
  render(<CreatePlaylistForm channelId="ch" onCreated={onCreated} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: 'Tafsir' } });
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Could not create the playlist. Please try again.');
  expect(screen.getByTestId('create-playlist-error')).toHaveTextContent('Reference: ref-2');
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ shown: true, status: 500 }));
  expect(onCreated).not.toHaveBeenCalled();
});

it('an Arabic name alone is the base name, sent for Arabic only', async () => {
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: { id: 'n', title: 'تفسير', name: 'تفسير', videos: [] } } });
  render(<CreatePlaylistForm channelId="ch" onCreated={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (Arabic)' }), { target: { value: 'تفسير' } });
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({ title: 'تفسير', titleLocalized: { ar: 'تفسير' } }), { channelId: 'ch' });
});

it('picked videos can be put in order before saving (manual), and that order is sent', async () => {
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: { id: 'n', title: 'T', name: 'T', videos: [] } } });
  render(<CreatePlaylistForm channelId="ch" onCreated={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: 'T' } });
  const rows = await screen.findAllByTestId('picker-video');
  fireEvent.click(within(rows[0]).getByRole('checkbox'));
  fireEvent.click(within(rows[1]).getByRole('checkbox'));
  fireEvent.click(within(rows[2]).getByRole('checkbox'));
  const order = () => screen.getAllByTestId('create-order-row').map((r) => r.getAttribute('data-video-id'));
  expect(order()).toEqual(['a', 'b', 'c']);
  // Move buttons, and Alt+arrows on a row
  fireEvent.click(within(screen.getAllByTestId('create-order-row')[0]).getByTestId('create-order-down'));
  expect(order()).toEqual(['b', 'a', 'c']);
  fireEvent.keyDown(screen.getAllByTestId('create-order-row')[2], { key: 'ArrowUp', altKey: true });
  expect(order()).toEqual(['b', 'c', 'a']);
  // The numbers follow, live, and the move is announced
  expect(screen.getAllByTestId('create-order-position').map((n) => n.textContent)).toEqual(['1', '2', '3']);
  expect(screen.getByTestId('create-order-status')).toHaveTextContent('Lesson c moved to position 2 of 3.');
  // The picker's numbers follow the same order
  expect(within(screen.getAllByTestId('picker-video')[2]).getByText('2')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({ sortMode: 'manual', videoIds: ['b', 'c', 'a'] }), { channelId: 'ch' });
});

it('an automatic order shows the videos without reorder controls', async () => {
  render(<CreatePlaylistForm channelId="ch" fixedVideos initialVideos={[{ id: 'a', title: 'Lesson a' }, { id: 'b', title: 'Lesson b' }]} onCreated={jest.fn()} />);
  expect(screen.getAllByTestId('create-order-handle')).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: /Automatic/ }));
  expect(screen.queryAllByTestId('create-order-handle')).toHaveLength(0);
  expect(screen.queryAllByTestId('create-order-up')).toHaveLength(0);
  expect(screen.getByText('This playlist is sorted automatically. Switch to Manual to put videos in your own order.')).toBeInTheDocument();
});

it('from a selection: no picker, the selection in order, reorderable and removable', async () => {
  (createManagedPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: { id: 'n', title: 'T', name: 'T', videos: [] } } });
  const onVideosChange = jest.fn();
  render(<CreatePlaylistForm channelId="ch" compact fixedVideos onVideosChange={onVideosChange} initialVideos={[{ id: 'a', title: 'Lesson a' }, { id: 'b', title: 'Lesson b' }, { id: 'c', title: 'Lesson c' }]} onCreated={jest.fn()} />);
  expect(screen.queryByTestId('video-picker')).toBeNull();
  expect(screen.queryByText('Videos (optional)')).toBeNull();
  expect(screen.getByText('Videos, in playlist order')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: 'T' } });
  fireEvent.click(within(screen.getAllByTestId('create-order-row')[2]).getByTestId('create-order-up'));
  fireEvent.click(within(screen.getAllByTestId('create-order-row')[0]).getByTestId('create-order-remove'));
  expect(onVideosChange).toHaveBeenLastCalledWith([{ id: 'c', title: 'Lesson c' }, { id: 'b', title: 'Lesson b' }]);
  expect(screen.getByTestId('create-playlist-submit')).toHaveTextContent('Create with 2 videos');
  await act(async () => { fireEvent.click(screen.getByTestId('create-playlist-submit')); });
  expect(createManagedPlaylist).toHaveBeenCalledWith(expect.objectContaining({ videoIds: ['c', 'b'] }), { channelId: 'ch' });
});

it('inline (compact): no description, starts from the given videos', async () => {
  render(<CreatePlaylistForm channelId="ch" compact initialVideos={[{ id: 'b', title: 'Lesson b' }]} onCreated={jest.fn()} />);
  expect(screen.queryByRole('textbox', { name: 'Description (English)' })).toBeNull();
  expect(await screen.findByTestId('create-order-row')).toHaveTextContent('Lesson b');
  expect(screen.getByTestId('create-playlist-submit')).toHaveTextContent('Create with 1 video');
});
