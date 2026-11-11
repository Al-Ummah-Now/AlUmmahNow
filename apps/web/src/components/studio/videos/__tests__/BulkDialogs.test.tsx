import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { BulkScheduleDialog } from '../BulkDialogs';

const schedule = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/lib/api/studio-content', () => ({
  bulkScheduleVideos: (...args: unknown[]) => schedule(...args),
}));

const mockStudio = STUDIO_EN;
const summary = { total: 2, succeeded: 2, failed: 0 };

describe('bulk schedule dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    schedule.mockResolvedValue(summary);
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
