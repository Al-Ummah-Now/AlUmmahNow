import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { DeletedVideos, daysLeft } from '../DeletedVideos';

const list = jest.fn();
const restore = jest.fn();
const purge = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { studio: mockStudio, confirmDialog: { typeToConfirm: 'Type {value} to confirm' }, common: { cancel: 'Cancel' } } }),
}));
jest.mock('@/lib/api/studio-content', () => ({
  listDeletedVideos: (...args: unknown[]) => list(...args),
  restoreVideos: (...args: unknown[]) => restore(...args),
  purgeVideos: (...args: unknown[]) => purge(...args),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn() } }));

const mockStudio = STUDIO_EN;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString();
const deleted = (id: string, extra = {}) => ({ id, title: `Video ${id}`, deletedAt: '2026-11-01T00:00:00.000Z', deletedBy: 'u1', purgeAfter: inDays(20), status: 'deleted', ...extra });

describe('DeletedVideos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    list.mockResolvedValue({ items: [deleted('a'), deleted('b', { status: 'queued' })], cursor: null });
    restore.mockResolvedValue({ total: 1, succeeded: 1, failed: 0 });
    purge.mockResolvedValue({ total: 1, succeeded: 1, failed: 0 });
  });

  it('counts whole days left', () => {
    expect(daysLeft(new Date(Date.now() + 2.5 * 86_400_000).toISOString())).toBe(2);
    expect(daysLeft(new Date(Date.now() - 1000).toISOString())).toBe(0);
  });

  it('shows days left, and queued videos as queued for permanent deletion', async () => {
    render(<DeletedVideos locale="en" channelId="c1" />);
    const rows = await screen.findAllByTestId('studio-deleted-row');
    expect(within(rows[0]).getByTestId('studio-deleted-status')).toHaveTextContent('Deleted permanently in 20 days');
    expect(within(rows[1]).getByTestId('studio-deleted-status')).toHaveTextContent(STUDIO_EN.videos.trash.queued);
    expect(within(rows[1]).queryByRole('button', { name: STUDIO_EN.videos.trash.purge })).not.toBeInTheDocument();
  });

  it('restores a video', async () => {
    const onChanged = jest.fn();
    render(<DeletedVideos locale="en" channelId="c1" onChanged={onChanged} />);
    const rows = await screen.findAllByTestId('studio-deleted-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: STUDIO_EN.videos.trash.restore }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(['a']));
    expect(await screen.findByText('1 restored.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('queues permanent deletion only after the word is typed', async () => {
    render(<DeletedVideos locale="en" channelId="c1" />);
    const rows = await screen.findAllByTestId('studio-deleted-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: STUDIO_EN.videos.trash.purge }));
    const confirm = await screen.findByTestId('studio-confirm-purge-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId('studio-confirm-purge-typed'), { target: { value: STUDIO_EN.videos.trash.confirmWord } });
    fireEvent.click(confirm);
    await waitFor(() => expect(purge).toHaveBeenCalledWith(['a']));
    expect(await screen.findByText('1 queued for permanent deletion.')).toBeInTheDocument();
  });

  it('says when nothing was deleted', async () => {
    list.mockResolvedValue({ items: [], cursor: null });
    render(<DeletedVideos locale="en" channelId="c1" />);
    expect(await screen.findByTestId('studio-deleted-empty')).toHaveTextContent(STUDIO_EN.videos.trash.empty);
  });
});
