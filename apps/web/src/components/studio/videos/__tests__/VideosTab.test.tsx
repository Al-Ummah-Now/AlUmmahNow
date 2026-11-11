import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BULK_EDIT_EN, STUDIO_EN } from '@al-ummah/shared-types';
import { VideosTab } from '../VideosTab';

const replace = jest.fn();
let search = '';
const list = jest.fn();
const counts = jest.fn();
const bulkDelete = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/studio/c1/content/videos',
  useRouter: () => ({ replace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('next/dynamic', () => function mockDynamic() {
  return function MockCalendar() {
    return <div data-testid="calendar" />;
  };
});
jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio, bulkEdit: mockBulkEdit }, lang: 'en', isRTL: false }) }));
jest.mock('@/lib/api/studio-content', () => ({
  listChannelContent: (...args: unknown[]) => list(...args),
  getChannelContentCounts: (...args: unknown[]) => counts(...args),
}));
jest.mock('@/lib/api/videos', () => ({ bulkDeleteVideos: (...args: unknown[]) => bulkDelete(...args), bulkUpdateVideos: jest.fn() }));
jest.mock('@/lib/api/scheduling', () => ({ cancelSchedule: jest.fn(), publishNow: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), info: jest.fn() } }));
const panel = jest.fn();
jest.mock('@/components/bulkEdit/BulkEditPanel', () => ({
  BulkEditPanel: (props: { open: boolean; videos: Array<{ id: string }> }) => {
    panel(props);
    return props.open ? <div data-testid="bulk-edit-panel">{props.videos.map((v) => v.id).join(',')}</div> : null;
  },
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { channels: [{ id: 'c1', name: 'Noor', nameLocalized: { ar: 'نور' } }] } }) }));
jest.mock('@/hooks/useChannelPlaylists', () => ({ useChannelPlaylists: () => ({ playlists: [{ id: 'p1' }], loading: false, failed: false, create: jest.fn() }) }));
jest.mock('@/components/playlists/AddToPlaylistDialog', () => ({
  __esModule: true,
  default: ({ open, videos }: { open: boolean; videos: Array<{ id: string }> }) =>
    open ? <div data-testid="add-to-playlist">{videos.map((v) => v.id).join(',')}</div> : null,
}));
jest.mock('../DeletedVideos', () => ({ DeletedVideos: () => <div data-testid="studio-deleted" /> }));
jest.mock('../BulkDialogs', () => ({
  BulkScheduleDialog: ({ open, onDone }: { open: boolean; onDone: (result: unknown) => void }) =>
    open ? <button onClick={() => onDone({ entitlement: 'studio.bulkSchedule', limit: null, current: null })}>refused</button> : null,
}));
jest.mock('@/components/calendar/ViewSwitcher', () => ({ ViewSwitcher: () => <div data-testid="view-switcher" /> }));
jest.mock('@/components/calendar/CalendarControls', () => ({ CalendarControls: () => null }));
jest.mock('@/components/calendar/utils/dateFormatters', () => ({ navigateNext: jest.fn(), navigatePrevious: jest.fn() }));

const mockStudio = STUDIO_EN;
const mockBulkEdit = BULK_EDIT_EN;
const video = (id: string, extra = {}) => ({ id, title: `Video ${id}`, dateCreated: '2026-01-01T00:00:00.000Z', views: 3, commentsCount: 1, likesCount: 2, isPublic: true, studioStatus: 'published', ...extra });
const ZERO = { published: 2, scheduled: 0, drafts: 0, processing: 0, failed: 0 };

function renderTab(role: 'owner' | 'editor' = 'owner') {
  return render(<VideosTab locale="en" channelId="c1" role={role} />);
}

describe('VideosTab', () => {
  beforeEach(() => {
    search = '';
    jest.clearAllMocks();
    counts.mockResolvedValue(ZERO);
    list.mockResolvedValue({ items: [video('a'), video('b', { isPublic: false })], cursor: null });
    bulkDelete.mockResolvedValue({ summary: { succeeded: 1, failed: 0 } });
  });

  it('lists the videos of the status in the URL, with counts', async () => {
    search = 'status=drafts';
    renderTab();
    expect(await screen.findAllByTestId('studio-video-row')).toHaveLength(2);
    expect(list.mock.calls[0][1]).toMatchObject({ status: 'drafts' });
    expect(screen.getByTestId('studio-status-published')).toHaveTextContent('Published (2)');
    expect(screen.getByTestId('studio-status-drafts')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the message for an empty status', async () => {
    search = 'status=failed';
    list.mockResolvedValue({ items: [], cursor: null });
    renderTab();
    expect(await screen.findByTestId('studio-videos-empty')).toHaveTextContent(STUDIO_EN.videos.empty.failed);
  });

  it('offers to clear filters when they match nothing', async () => {
    search = 'visibility=private';
    list.mockResolvedValue({ items: [], cursor: null });
    renderTab();
    expect(await screen.findByTestId('studio-videos-empty')).toHaveTextContent(STUDIO_EN.videos.empty.filtered);
  });

  it('keeps the status in the URL when it changes', async () => {
    renderTab();
    await screen.findAllByTestId('studio-video-row');
    fireEvent.click(screen.getByTestId('studio-status-scheduled'));
    expect(replace).toHaveBeenCalledWith('/en/studio/c1/content/videos?status=scheduled', { scroll: false });
  });

  it('shows Retry when loading fails, and recovers', async () => {
    list.mockResolvedValueOnce(null);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: STUDIO_EN.videos.retry }));
    expect(await screen.findAllByTestId('studio-video-row')).toHaveLength(2);
  });

  it('shows the bulk bar and deletes after confirmation', async () => {
    renderTab();
    const rows = await screen.findAllByTestId('studio-video-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    expect(screen.getByTestId('studio-bulk-bar')).toHaveTextContent('1 selected');
    fireEvent.click(within(screen.getByTestId('studio-bulk-bar')).getByRole('button', { name: STUDIO_EN.videos.bulk.delete }));
    expect(await screen.findByTestId('studio-confirm-delete')).toHaveTextContent(STUDIO_EN.videos.confirmDelete.body);
    fireEvent.click(screen.getByTestId('studio-confirm-delete-confirm'));
    await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith(['a'], { channelId: 'c1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 moved to Recently deleted.');
  });

  it('cancelling the confirmation deletes nothing', async () => {
    renderTab();
    const rows = await screen.findAllByTestId('studio-video-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('studio-bulk-delete'));
    fireEvent.click(await screen.findByTestId('studio-confirm-delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('studio-confirm-delete')).not.toBeInTheDocument());
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it('adds the selection to a playlist with the shared playlist dialog', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('checkbox', { name: STUDIO_EN.videos.selectAll }));
    fireEvent.click(screen.getByTestId('studio-bulk-playlist'));
    expect(await screen.findByTestId('add-to-playlist')).toHaveTextContent('a,b');
  });

  it('opens Recently deleted for roles that can delete, and only for them', async () => {
    search = 'status=deleted';
    renderTab();
    expect(await screen.findByTestId('studio-deleted')).toBeInTheDocument();
    expect(screen.getByTestId('studio-status-deleted')).toHaveAttribute('aria-pressed', 'true');
    expect(list).not.toHaveBeenCalled();
  });

  it('reports a partial delete', async () => {
    bulkDelete.mockResolvedValue({ summary: { succeeded: 1, failed: 1 } });
    renderTab();
    fireEvent.click(await screen.findByRole('checkbox', { name: STUDIO_EN.videos.selectAll }));
    fireEvent.click(within(screen.getByTestId('studio-bulk-bar')).getByRole('button', { name: STUDIO_EN.videos.bulk.delete }));
    fireEvent.click(await screen.findByTestId('studio-confirm-delete-confirm'));
    expect(await screen.findByText('1 deleted, 1 could not be deleted.')).toBeInTheDocument();
  });

  it('says which plan limit refused a bulk action', async () => {
    renderTab();
    const rows = await screen.findAllByTestId('studio-video-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(within(screen.getByTestId('studio-bulk-bar')).getByRole('button', { name: STUDIO_EN.videos.bulk.schedule }));
    fireEvent.click(await screen.findByText('refused'));
    expect(await screen.findByRole('status')).toHaveTextContent(STUDIO_EN.limits.bulkSchedule);
    expect(screen.getByRole('status')).not.toHaveTextContent(STUDIO_EN.videos.actionFailed);
  });

  it('marks private videos', async () => {
    renderTab();
    const rows = await screen.findAllByTestId('studio-video-row');
    expect(rows[1]).toHaveTextContent(STUDIO_EN.videos.badges.private);
    expect(rows[0]).not.toHaveTextContent(STUDIO_EN.videos.badges.private);
  });

  it('offers list and calendar only on Scheduled', async () => {
    renderTab();
    await screen.findAllByTestId('studio-video-row');
    expect(screen.queryByTestId('view-switcher')).toBeNull();
  });

  it('shows the calendar when asked', async () => {
    search = 'status=scheduled&view=calendar';
    renderTab();
    expect(await screen.findByTestId('calendar')).toBeInTheDocument();
    expect(list.mock.calls[0][1]).toMatchObject({ status: 'scheduled', limit: 100 });
  });

  it('opens the bulk edit panel from the one bulk bar with the selected videos', async () => {
    renderTab();
    await screen.findAllByTestId('studio-video-row');
    fireEvent.click(screen.getAllByTestId('studio-video-select')[1]);
    fireEvent.click(within(screen.getByTestId('studio-bulk-bar')).getByTestId('studio-bulk-edit'));
    expect(await screen.findByTestId('bulk-edit-panel')).toHaveTextContent('b');
    const props = panel.mock.calls[panel.mock.calls.length - 1][0];
    expect(props.videos[0]).toMatchObject({ id: 'b', channelId: 'c1', channelName: { en: 'Noor', ar: 'نور' } });
    expect(props.playlists.list).toEqual([{ id: 'p1' }]);
    expect(screen.getAllByTestId('studio-bulk-bar')).toHaveLength(1);
  });

  it('selects every video matching the filter across pages, for Edit only beyond 50', async () => {
    counts.mockResolvedValue({ ...ZERO, published: 70 });
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => video(`v${from + i}`));
    list.mockImplementation((_c: string, params: { cursor?: string }) => Promise.resolve(
      params.cursor === 'p2' ? { items: page(30, 40), cursor: null } : { items: page(0, 30), cursor: 'p2' },
    ));
    renderTab();
    await screen.findAllByTestId('studio-video-row');
    fireEvent.click(screen.getByTestId('studio-select-all'));
    fireEvent.click(await screen.findByTestId('studio-select-all-matching'));
    await waitFor(() => expect(screen.getByTestId('studio-bulk-bar')).toHaveTextContent('70 selected'));
    expect(list).toHaveBeenLastCalledWith('c1', expect.objectContaining({ cursor: 'p2' }));
    expect(screen.getByTestId('studio-bulk-delete')).toBeDisabled();
    expect(screen.getByTestId('studio-bulk-other-limit')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('studio-bulk-edit'));
    expect((await screen.findByTestId('bulk-edit-panel')).textContent?.split(',')).toHaveLength(70);
  });
});
