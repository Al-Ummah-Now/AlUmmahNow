import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { LiveTab } from '../LiveTab';

const list = jest.fn();
const create = jest.fn();
const remove = jest.fn();
const push = jest.fn();
const refresh = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { studio: mockStudio, confirmDialog: { typeToConfirm: 'Type {value}' }, common: { cancel: 'Cancel' } }, lang: 'en' }),
}));
jest.mock('@/lib/live/api', () => {
  const actual = jest.requireActual('@/lib/live/api');
  return {
    ...actual,
    listChannelStreams: (...a: unknown[]) => list(...a),
    createStream: (...a: unknown[]) => create(...a),
    deleteStream: (...a: unknown[]) => remove(...a),
  };
});
const mockCreator = jest.fn();
jest.mock('@/hooks/useCreatorAccess', () => ({ useCreatorAccess: () => mockCreator() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.live;
const row = (id: string, status = 'scheduled') => ({ id, title: `Stream ${id}`, status, dateCreated: '2026-11-11T09:00:00.000Z' });

describe('Studio LiveTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreator.mockReturnValue({ status: 'loading' });
    list.mockResolvedValue({ items: [row('a'), row('b', 'live')], cursor: null });
  });

  it('lists the channel\'s streams with their status and Go live / Watch links', async () => {
    render(<LiveTab locale="ar" channelId="c1" role="owner" />);
    const rows = await screen.findAllByTestId('studio-live-row');
    expect(list).toHaveBeenCalledWith('c1', null, expect.anything());
    expect(within(rows[1]).getByTestId('studio-live-status')).toHaveTextContent(text.status.live);
    expect(within(rows[0]).getByTestId('studio-live-manage')).toHaveAttribute('href', '/ar/studio/c1/content/live/a');
    expect(within(rows[0]).getByRole('link', { name: text.watch })).toHaveAttribute('href', '/ar/live/a');
  });

  it('names the row link by status: Go live before it starts, Manage stream while live, Details after', async () => {
    list.mockResolvedValue({ items: [row('a'), row('b', 'live'), row('c', 'ended'), row('d', 'cancelled')], cursor: null });
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    const rows = await screen.findAllByTestId('studio-live-row');
    expect(within(rows[0]).getByTestId('studio-live-manage')).toHaveTextContent(text.manage);
    expect(within(rows[1]).getByTestId('studio-live-manage')).toHaveTextContent(text.manageLive);
    expect(within(rows[2]).getByTestId('studio-live-manage')).toHaveTextContent(text.details);
    expect(within(rows[3]).getByTestId('studio-live-manage')).toHaveTextContent(text.details);
  });

  it('creates a stream and opens its Go live page', async () => {
    create.mockResolvedValue({ id: 'new1', title: 'Talk', status: 'scheduled' });
    render(<LiveTab locale="en" channelId="c1" role="admin" />);
    fireEvent.click(await screen.findByTestId('studio-live-create'));
    expect(await screen.findByTestId('studio-live-error')).toHaveTextContent(text.form.titleRequired);
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('studio-live-title'), { target: { value: '  Talk ' } });
    fireEvent.change(screen.getByTestId('studio-live-description'), { target: { value: 'About' } });
    fireEvent.click(screen.getByTestId('studio-live-private'));
    fireEvent.click(screen.getByTestId('studio-live-create'));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c1', { title: 'Talk', description: 'About', isPrivate: true }));
    expect(push).toHaveBeenCalledWith('/en/studio/c1/content/live/new1');
  });

  it('shows the friendly message when live is at capacity', async () => {
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    create.mockRejectedValue(new LiveApiError(503, 'live_capacity'));
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
    fireEvent.click(screen.getByTestId('studio-live-create'));
    expect(await screen.findByTestId('studio-live-error')).toHaveTextContent(text.errors.live_capacity);
    expect(push).not.toHaveBeenCalled();
  });

  it('live switched off meanwhile (404 feature_off): no message, the page re-renders without Live', async () => {
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    create.mockRejectedValue(new LiveApiError(404, 'feature_off'));
    render(<LiveTab locale="en" channelId="c1" role="admin" />);
    fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
    fireEvent.click(screen.getByTestId('studio-live-create'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByTestId('studio-live-error')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes only after the in-app confirm', async () => {
    remove.mockResolvedValue(undefined);
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    const rows = await screen.findAllByTestId('studio-live-row');
    fireEvent.click(within(rows[0]).getByTestId('studio-live-delete'));
    const dialog = await screen.findByTestId('studio-live-delete-dialog');
    expect(dialog).toHaveTextContent('“Stream a”');
    fireEvent.click(screen.getByTestId('studio-live-delete-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('studio-live-delete-dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(rows[0]).getByTestId('studio-live-delete'));
    fireEvent.click(await screen.findByTestId('studio-live-delete-dialog-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.getAllByTestId('studio-live-row')).toHaveLength(1));
    expect(screen.getByTestId('studio-live-notice')).toHaveTextContent(text.deleted);
  });

  it('is read-only for a moderator', async () => {
    render(<LiveTab locale="en" channelId="c1" role="moderator" />);
    await screen.findAllByTestId('studio-live-row');
    expect(screen.queryByTestId('studio-live-form')).toBeNull();
    expect(screen.getByTestId('studio-live-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-live-delete')).toBeNull();
    expect(screen.queryByTestId('studio-live-manage')).toBeNull();
  });

  it('shows the empty state', async () => {
    list.mockResolvedValue({ items: [], cursor: null });
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    expect(await screen.findByTestId('studio-live-empty')).toHaveTextContent(text.empty);
  });

  describe('live quota (plain facts, no upsell)', () => {
    const live = (over: Record<string, unknown>) => ({ status: 'ready', access: { live: { allowed: true, reason: null, unlimited: false, hoursMonth: 20, usedMinutes: 90, maxConcurrent: 1, maxStreamMinutes: 240, ...over } } });

    it('shows the month\'s usage to an owner whose tier allows live', async () => {
      mockCreator.mockReturnValue(live({}));
      render(<LiveTab locale="en" channelId="c1" role="owner" />);
      expect(await screen.findByTestId('studio-live-quota')).toHaveTextContent('1.5');
      expect(screen.getByTestId('studio-live-create')).toBeInTheDocument();
    });

    it('says the month\'s hours are used as a plain fact, hides the form, no link', async () => {
      mockCreator.mockReturnValue(live({ allowed: false, reason: 'hours_used', usedMinutes: 1200 }));
      render(<LiveTab locale="en" channelId="c1" role="owner" />);
      const quota = await screen.findByTestId('studio-live-quota');
      expect(quota).toHaveAttribute('data-reason', 'hours_used');
      expect(quota).toHaveTextContent('20');
      expect(quota.querySelector('a')).toBeNull();
      expect(screen.queryByTestId('studio-live-create')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /upgrade|request/i })).not.toBeInTheDocument();
      // The streams already made stay listed, with no "Go live" offer that can't start
      const rows = await screen.findAllByTestId('studio-live-row');
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByTestId('studio-live-manage')).toHaveTextContent(text.details);
      expect(within(rows[1]).getByTestId('studio-live-manage')).toHaveTextContent(text.manageLive);
      expect(screen.queryByText(text.manage)).not.toBeInTheDocument();
    });

    it('unlimited: nothing to say', async () => {
      mockCreator.mockReturnValue(live({ unlimited: true, hoursMonth: null }));
      render(<LiveTab locale="en" channelId="c1" role="owner" />);
      await screen.findAllByTestId('studio-live-row');
      expect(screen.queryByTestId('studio-live-quota')).not.toBeInTheDocument();
    });

    it('a channel admin hears the owner\'s used hours from the server, plainly', async () => {
      const { LiveApiError } = jest.requireActual('@/lib/live/api');
      create.mockRejectedValue(new LiveApiError(402, 'live_hours_used'));
      render(<LiveTab locale="en" channelId="c1" role="admin" />);
      fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
      fireEvent.click(screen.getByTestId('studio-live-create'));
      const error = await screen.findByTestId('studio-live-error');
      expect(error).toHaveTextContent(text.errors.live_hours_used);
      expect(error.querySelector('a')).toBeNull();
    });
  });
});
