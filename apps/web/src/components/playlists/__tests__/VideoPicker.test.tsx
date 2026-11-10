import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VideoPicker, { type PickedVideo } from '../VideoPicker';
import { listVideos } from '@/lib/api/videos';
import { reportError } from '@/lib/errors/reporter';
import { video } from './testUtils';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/videos', () => ({ listVideos: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref-1') }));

const list = listVideos as jest.Mock;

function Harness({ exclude, onPick }: { exclude?: string[]; onPick?: (v: PickedVideo[]) => void }) {
  const [selected, setSelected] = useState<PickedVideo[]>([]);
  return (
    <VideoPicker
      channelId="ch"
      selected={selected}
      onChange={(next) => { setSelected(next); onPick?.(next); }}
      excludeIds={exclude ? new Set(exclude) : undefined}
      pageSize={3}
    />
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  list.mockReset();
  (reportError as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

async function flush() {
  await act(async () => { jest.advanceTimersByTime(400); });
}

it('selects in click order, numbers the picks and lists them in the tray', async () => {
  list.mockResolvedValue({ data: [video('a'), video('b', { isShort: true }), video('c')], cursor: null });
  const onPick = jest.fn();
  render(<Harness onPick={onPick} />);
  await flush();
  const rows = await screen.findAllByTestId('picker-video');
  fireEvent.click(within(rows[2]).getByRole('checkbox'));
  fireEvent.click(within(rows[0]).getByRole('checkbox'));
  expect(onPick).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'a' })]);
  expect(within(rows[2]).getByText('1')).toBeInTheDocument();
  expect(within(rows[0]).getByText('2')).toBeInTheDocument();
  expect(screen.getAllByTestId('picker-tray-item').map((el) => el.textContent)).toEqual(['1Lesson c', '2Lesson a']);
  expect(screen.getByTestId('picker-selected-count')).toHaveTextContent('2 selected');
  // Shorts are marked
  expect(within(rows[1]).getByText('Short')).toBeInTheDocument();
});

it('"select all on this page" skips videos already in the playlist and toggles back', async () => {
  list.mockResolvedValue({ data: [video('a'), video('b'), video('c')], cursor: null });
  const onPick = jest.fn();
  render(<Harness exclude={['b']} onPick={onPick} />);
  await flush();
  await screen.findAllByTestId('picker-video');
  fireEvent.click(screen.getByTestId('picker-select-page'));
  expect(onPick).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'c' })]);
  expect(screen.getByText('In playlist')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('picker-select-page'));
  expect(onPick).toHaveBeenLastCalledWith([]);
});

it('pages with the cursor through every video, and back', async () => {
  list
    .mockResolvedValueOnce({ data: [video('a'), video('b'), video('c')], cursor: 'next-1' })
    .mockResolvedValueOnce({ data: [video('d')], cursor: null })
    .mockResolvedValueOnce({ data: [video('a'), video('b'), video('c')], cursor: 'next-1' });
  render(<Harness />);
  await flush();
  await screen.findByText('Lesson a');
  fireEvent.click(screen.getByTestId('picker-next'));
  await screen.findByText('Lesson d');
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ channelId: 'ch', cursor: 'next-1' }), { channelId: 'ch' });
  expect(screen.getByTestId('picker-page')).toHaveTextContent('Page 2');
  expect(screen.getByTestId('picker-next')).toBeDisabled();
  fireEvent.click(screen.getByTestId('picker-prev'));
  await screen.findByText('Lesson a');
  expect(screen.getByTestId('picker-page')).toHaveTextContent('Page 1');
});

it('searches (debounced) and filters by format, starting again at page 1', async () => {
  list.mockResolvedValue({ data: [video('a')], cursor: null });
  render(<Harness />);
  await flush();
  fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'tafsir' } });
  await flush();
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'tafsir' }), { channelId: 'ch' }));
  fireEvent.click(screen.getByTestId('picker-format-short'));
  await flush();
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'tafsir', format: 'short' }), { channelId: 'ch' }));
  expect(screen.getByTestId('picker-format-short')).toHaveAttribute('aria-pressed', 'true');
});

it('a short search page follows the cursor to fill the page', async () => {
  list
    .mockResolvedValueOnce({ data: [video('a')], cursor: 'more' })
    .mockResolvedValueOnce({ data: [video('b'), video('c')], cursor: 'rest' });
  render(<Harness />);
  await flush();
  await screen.findByText('Lesson c');
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: 'more', limit: 2 }));
  expect(screen.getByTestId('picker-next')).not.toBeDisabled();
});

it('a failed load shows a friendly message, reports it, and retries', async () => {
  list.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ data: [video('a')], cursor: null });
  render(<Harness />);
  await flush();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your videos');
  expect(screen.queryByText('boom')).toBeNull();
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ shown: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Lesson a');
});

it('an empty channel says so', async () => {
  list.mockResolvedValue({ data: [], cursor: null });
  render(<Harness />);
  await flush();
  expect(await screen.findByText('This channel has no videos yet.')).toBeInTheDocument();
});
