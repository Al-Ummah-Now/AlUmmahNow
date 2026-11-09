import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { BulkPlaylistDialog, BulkScheduleDialog } from '../BulkDialogs';

const add = jest.fn();
const schedule = jest.fn();
const playlists = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/lib/api/playlists', () => ({ listPlaylists: (...args: unknown[]) => playlists(...args) }));
jest.mock('@/lib/api/studio-content', () => ({
  bulkAddToPlaylist: (...args: unknown[]) => add(...args),
  bulkScheduleVideos: (...args: unknown[]) => schedule(...args),
}));

const mockStudio = STUDIO_EN;
const summary = { total: 2, succeeded: 2, failed: 0 };

describe('bulk dialogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    add.mockResolvedValue(summary);
    schedule.mockResolvedValue(summary);
  });

  it('adds the selection to the chosen playlist', async () => {
    playlists.mockResolvedValue({ data: [{ id: 'p1', title: 'Tafsir' }] });
    const onDone = jest.fn();
    render(<BulkPlaylistDialog open channelId="c1" videoIds={['a', 'b']} onOpenChange={jest.fn()} onDone={onDone} />);
    await screen.findByRole('option', { name: 'Tafsir' });
    fireEvent.click(screen.getByRole('button', { name: STUDIO_EN.videos.bulkPlaylist.submit }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(summary));
    expect(add).toHaveBeenCalledWith('p1', ['a', 'b']);
  });

  it('says when the channel has no playlists, and offers nothing to submit', async () => {
    playlists.mockResolvedValue({ data: [] });
    render(<BulkPlaylistDialog open channelId="c1" videoIds={['a']} onOpenChange={jest.fn()} onDone={jest.fn()} />);
    expect(await screen.findByText(STUDIO_EN.videos.bulkPlaylist.none)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STUDIO_EN.videos.bulkPlaylist.submit })).toBeDisabled();
  });

  it('schedules from the chosen time and interval', async () => {
    const onDone = jest.fn();
    render(<BulkScheduleDialog open videoIds={['a', 'b']} onOpenChange={jest.fn()} onDone={onDone} />);
    expect(screen.getByRole('button', { name: STUDIO_EN.videos.bulkSchedule.submit })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(STUDIO_EN.videos.bulkSchedule.start), { target: { value: '2027-01-01T10:00' } });
    fireEvent.change(screen.getByLabelText(STUDIO_EN.videos.bulkSchedule.interval), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO_EN.videos.bulkSchedule.submit }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(summary));
    expect(schedule.mock.calls[0][0]).toMatchObject({ videoIds: ['a', 'b'], intervalMinutes: 60 });
  });
});
