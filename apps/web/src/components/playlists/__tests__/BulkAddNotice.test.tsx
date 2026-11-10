import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BulkAddNotice from '../BulkAddNotice';
import { addVideosToPlaylist, getPlaylistAddJob, retryPlaylistAddJob } from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/playlists', () => ({ addVideosToPlaylist: jest.fn(), getPlaylistAddJob: jest.fn(), retryPlaylistAddJob: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-9') }));

const base = { playlistId: 'pl', playlistTitle: 'Tafsir', channelId: 'ch', videoIds: ['a', 'b'] };
const result = (extra: Record<string, unknown>) => ({ status: 'done', added: 0, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 0, ...extra });
const job = (extra: Record<string, unknown>) => ({ id: 'j1', playlistId: 'pl', status: 'running', total: 300, processed: 100, added: 100, notInChannel: 0, updatedAt: '', ...extra });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('done: says how many were added and what was skipped, and tells the page', () => {
  const onChanged = jest.fn();
  render(<BulkAddNotice {...base} onChanged={onChanged} outcome={{ kind: 'result', result: result({ added: 12, alreadyInPlaylist: 2, notInChannel: 1 }) as never }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Added 12 videos to Tafsir.');
  expect(screen.getByRole('status')).toHaveTextContent('2 already in the playlist.');
  expect(screen.getByRole('status')).toHaveTextContent('1 no longer available on this channel, skipped.');
  expect(onChanged).toHaveBeenCalled();
});

it('nothing new: every video was already there', () => {
  render(<BulkAddNotice {...base} outcome={{ kind: 'result', result: result({ alreadyInPlaylist: 2 }) as never }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Every selected video is already in Tafsir.');
});

it('queued: follows the job with progress until it finishes', async () => {
  (getPlaylistAddJob as jest.Mock)
    .mockResolvedValueOnce({ ok: true, data: job({}) })
    .mockResolvedValueOnce({ ok: true, data: job({ status: 'succeeded', processed: 300, added: 300 }) });
  const onChanged = jest.fn();
  render(<BulkAddNotice {...base} pollMs={1000} onChanged={onChanged} outcome={{ kind: 'result', result: result({ status: 'queued', added: 200, pending: 300, jobId: 'j1' }) as never }} />);
  await act(async () => {});
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByText('100 of 300 done')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(screen.getByRole('status')).toHaveTextContent('All videos are now in Tafsir.');
  expect(onChanged).toHaveBeenCalled();
});

it('a failed job: our team is notified, Retry restarts the job', async () => {
  (getPlaylistAddJob as jest.Mock).mockResolvedValue({ ok: true, data: job({ status: 'failed' }) });
  (retryPlaylistAddJob as jest.Mock).mockResolvedValue({ ok: true, data: job({ status: 'queued' }) });
  render(<BulkAddNotice {...base} outcome={{ kind: 'result', result: result({ status: 'queued', pending: 300, jobId: 'j1' }) as never }} />);
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('Our team has been notified');
  expect(reportError).toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByTestId('bulk-add-retry')); });
  expect(retryPlaylistAddJob).toHaveBeenCalledWith('pl', 'j1', { channelId: 'ch' });
});

it('a request that failed: friendly words, the reference, and Retry re-sends the same ids', async () => {
  (addVideosToPlaylist as jest.Mock).mockResolvedValue({ ok: true, data: result({ added: 2 }) });
  render(<BulkAddNotice {...base} justCreated outcome={{ kind: 'request-failed', status: 503, ref: 'ref-1' }} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Tafsir was created, but its videos couldn't be added yet.");
  expect(screen.getByRole('alert')).toHaveTextContent('Reference: ref-1');
  await act(async () => { fireEvent.click(screen.getByTestId('bulk-add-retry')); });
  expect(addVideosToPlaylist).toHaveBeenCalledWith('pl', ['a', 'b'], { channelId: 'ch' });
  expect(screen.getByRole('status')).toHaveTextContent('Added 2 videos to Tafsir.');
});

it('forbidden: no Retry', () => {
  render(<BulkAddNotice {...base} outcome={{ kind: 'request-failed', status: 403 }} />);
  expect(screen.getByRole('alert')).toHaveTextContent("You don't have permission to change Tafsir.");
  expect(screen.queryByTestId('bulk-add-retry')).toBeNull();
});

it('a playlist created without videos says it was created', () => {
  render(<BulkAddNotice {...base} justCreated outcome={{ kind: 'result', result: result({}) as never }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Created Tafsir.');
});
