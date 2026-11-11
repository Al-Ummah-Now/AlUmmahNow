import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import PlaylistEditor from '../PlaylistEditor';
import {
  addVideosToPlaylist,
  getPlaylistAddJob,
  getPlaylistManageItems,
  removeVideosFromPlaylist,
  reorderPlaylistVideos,
  savePlaylist,
} from '@/lib/api/playlists';
import { listVideos } from '@/lib/api/videos';
import { reportError } from '@/lib/errors/reporter';
import { video } from './testUtils';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/playlists', () => ({
  addVideosToPlaylist: jest.fn(), getPlaylistAddJob: jest.fn(), retryPlaylistAddJob: jest.fn(), getPlaylistManageItems: jest.fn(),
  removeVideosFromPlaylist: jest.fn(), reorderPlaylistVideos: jest.fn(), savePlaylist: jest.fn(),
}));
jest.mock('@/lib/api/videos', () => ({ listVideos: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-4') }));

const meta = (extra: Record<string, unknown> = {}) => ({ id: 'pl', title: 'Tafsir', isPublic: true, channelId: 'ch', videosCount: 3, sortMode: 'manual', sortField: 'added', sortDirection: 'desc', ...extra });
const item = (id: string, position: number, extra: Record<string, unknown> | null = {}) => ({ id, position, video: extra === null ? null : { ...video(id), ...extra } });
const page = (items: unknown[], nextOffset: number | null, extra: Record<string, unknown> = {}) => ({ ok: true, data: { playlist: meta(extra), items, nextOffset } });
const order = () => screen.getAllByTestId('playlist-item').map((el) => el.getAttribute('data-video-id'));

beforeEach(() => {
  jest.clearAllMocks();
  (listVideos as jest.Mock).mockResolvedValue({ data: [video('a'), video('d')], cursor: null });
});

async function renderEditor(extra?: Record<string, unknown>) {
  (getPlaylistManageItems as jest.Mock)
    .mockResolvedValueOnce(page([item('a', 0), item('b', 1, { isShort: true })], 2, extra))
    .mockResolvedValueOnce(page([item('gone', 2, null)], null, extra));
  render(<PlaylistEditor channelId="ch" playlistId="pl" />);
  await screen.findByTestId('playlist-editor');
}

it('loads every page of the playlist, with its count and unavailable rows', async () => {
  await renderEditor();
  expect(getPlaylistManageItems).toHaveBeenNthCalledWith(2, 'pl', { offset: 2, limit: 100 }, { channelId: 'ch' });
  expect(order()).toEqual(['a', 'b', 'gone']);
  expect(screen.getByTestId('playlist-item-count')).toHaveTextContent('3 videos');
  expect(screen.getByText('Video unavailable')).toBeInTheDocument();
  // Manual: drag handles with names, and move buttons
  expect(screen.getByRole('button', { name: 'Reorder Lesson a' })).toBeInTheDocument();
});

it('Move down saves the new order at once; the stored order wins', async () => {
  await renderEditor();
  (reorderPlaylistVideos as jest.Mock).mockResolvedValue({ ok: true, data: { videos: ['b', 'a', 'gone'] } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move Lesson a down' })); });
  expect(reorderPlaylistVideos).toHaveBeenCalledWith('pl', ['b', 'a', 'gone'], { channelId: 'ch' });
  expect(order()).toEqual(['b', 'a', 'gone']);
  expect(screen.getByText('Order saved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Move Lesson b up' })).toBeDisabled();
});

it('Alt+Down on a row moves it (the bulk-rename shortcut) and saves', async () => {
  await renderEditor();
  (reorderPlaylistVideos as jest.Mock).mockResolvedValue({ ok: true, data: { videos: ['b', 'a', 'gone'] } });
  const row = screen.getAllByTestId('playlist-item')[0];
  await act(async () => { fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true }); });
  expect(reorderPlaylistVideos).toHaveBeenCalledWith('pl', ['b', 'a', 'gone'], { channelId: 'ch' });
  // Without Alt the arrows are left to the drag handle
  (reorderPlaylistVideos as jest.Mock).mockClear();
  await act(async () => { fireEvent.keyDown(screen.getAllByTestId('playlist-item')[0], { key: 'ArrowDown' }); });
  expect(reorderPlaylistVideos).not.toHaveBeenCalled();
});

it('a failed reorder puts the order back and says so', async () => {
  await renderEditor();
  (reorderPlaylistVideos as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move Lesson b up' })); });
  expect(order()).toEqual(['a', 'b', 'gone']);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not update the playlist');
  expect(reportError).toHaveBeenCalled();
});

it('automatic order: no handles or move buttons, a hint instead', async () => {
  await renderEditor({ sortMode: 'auto', sortField: 'views', sortDirection: 'desc' });
  expect(screen.queryByTestId('playlist-item-handle')).toBeNull();
  expect(screen.queryByTestId('playlist-item-up')).toBeNull();
  expect(screen.getByText(/sorted automatically/)).toBeInTheDocument();
  expect(screen.getByTestId('sort-field')).toHaveValue('views');
});

it('changing the order saves it and reloads the server order', async () => {
  await renderEditor();
  (savePlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: {} } });
  (getPlaylistManageItems as jest.Mock).mockResolvedValueOnce(page([item('b', 0), item('a', 1)], null, { sortMode: 'auto', sortField: 'added', sortDirection: 'desc' }));
  await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Automatic/ })); });
  expect(savePlaylist).toHaveBeenCalledWith('pl', { sortMode: 'auto', sortField: 'added', sortDirection: 'desc' }, { channelId: 'ch' });
  expect(order()).toEqual(['b', 'a']);
  expect(screen.getByText('Order updated')).toBeInTheDocument();
  expect(screen.queryByTestId('playlist-item-handle')).toBeNull();
});

it('remove takes the video out (unavailable ones too)', async () => {
  await renderEditor();
  (removeVideosFromPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { removed: 1, videosCount: 2 } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Video unavailable from the playlist' })); });
  // The in-app confirm dialog asks first
  expect(removeVideosFromPlaylist).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByTestId('playlist-editor-remove-dialog-confirm')); });
  expect(removeVideosFromPlaylist).toHaveBeenCalledWith('pl', ['gone'], { channelId: 'ch' });
  expect(order()).toEqual(['a', 'b']);
});

it('add videos: the picker marks what is already in it, then one bulk add and a reload', async () => {
  await renderEditor();
  (addVideosToPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { status: 'done', added: 1, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 4 } });
  (getPlaylistManageItems as jest.Mock).mockResolvedValue(page([item('a', 0), item('b', 1), item('gone', 2, null), item('d', 3)], null));
  fireEvent.click(screen.getByTestId('playlist-add-videos'));
  const panel = await screen.findByTestId('playlist-add-panel');
  const rows = await within(panel).findAllByTestId('picker-video');
  expect(within(rows[0]).getByRole('checkbox')).toBeDisabled();
  fireEvent.click(within(rows[1]).getByRole('checkbox'));
  await act(async () => { fireEvent.click(screen.getByTestId('playlist-add-submit')); });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('pl', ['d'], { channelId: 'ch' });
  expect(screen.getByText('Added 1 video to Tafsir.')).toBeInTheDocument();
  expect(order()).toEqual(['a', 'b', 'gone', 'd']);
});

it('details: an existing single-language name fills its language; the other stays empty', async () => {
  await renderEditor();
  expect(screen.getByRole('textbox', { name: 'Name (English)' })).toHaveValue('Tafsir');
  expect(screen.getByRole('textbox', { name: 'Name (Arabic)' })).toHaveValue('');
});

it('details: English and Arabic names and descriptions are saved separately', async () => {
  await renderEditor({ titleLocalized: { en: 'Tafsir', ar: 'تفسير' }, description: 'About', descriptionLocalized: { en: 'About' } });
  expect(screen.getByRole('textbox', { name: 'Name (Arabic)' })).toHaveValue('تفسير');
  (savePlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: {} } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (Arabic)' }), { target: { value: 'التفسير' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description (Arabic)' }), { target: { value: 'نبذة' } });
  await act(async () => { fireEvent.click(screen.getByTestId('playlist-details-save')); });
  expect(savePlaylist).toHaveBeenCalledWith('pl', expect.objectContaining({
    title: 'Tafsir', titleLocalized: { en: 'Tafsir', ar: 'التفسير' }, description: 'About', descriptionLocalized: { en: 'About', ar: 'نبذة' },
  }), { channelId: 'ch' });
});

it('details: saves name, visibility and the chosen cover video', async () => {
  await renderEditor();
  (savePlaylist as jest.Mock).mockResolvedValue({ ok: true, data: { playlist: {} } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name (English)' }), { target: { value: 'Tafsir 2' } });
  fireEvent.click(screen.getByRole('radio', { name: /^Private/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Use the thumbnail of Lesson b' }));
  await act(async () => { fireEvent.click(screen.getByTestId('playlist-details-save')); });
  expect(savePlaylist).toHaveBeenCalledWith('pl', { title: 'Tafsir 2', titleLocalized: { en: 'Tafsir 2' }, description: '', descriptionLocalized: {}, isPublic: false, coverVideoId: 'b' }, { channelId: 'ch' });
  expect(screen.getByText('Changes saved')).toBeInTheDocument();
});

it('follows a background add started by the create form', async () => {
  (getPlaylistManageItems as jest.Mock).mockResolvedValue(page([item('a', 0)], null));
  (getPlaylistAddJob as jest.Mock).mockResolvedValue({ ok: true, data: { id: 'j1', playlistId: 'pl', status: 'running', total: 500, processed: 200, added: 200, notInChannel: 0, updatedAt: '' } });
  render(<PlaylistEditor channelId="ch" playlistId="pl" initialJobId="j1" />);
  expect(await screen.findByText('200 of 500 done')).toBeInTheDocument();
});

it('a playlist that cannot be loaded: friendly error with Try again', async () => {
  (getPlaylistManageItems as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce(page([item('a', 0)], null));
  render(<PlaylistEditor channelId="ch" playlistId="pl" />);
  expect(await screen.findByTestId('playlist-editor-error')).toHaveTextContent("Could not load the playlist's videos");
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  expect(await screen.findByTestId('playlist-editor')).toBeInTheDocument();
});
