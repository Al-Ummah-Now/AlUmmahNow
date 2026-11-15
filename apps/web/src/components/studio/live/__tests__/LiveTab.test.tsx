import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { LiveTab } from '../LiveTab';

const list = jest.fn();
const create = jest.fn();
const remove = jest.fn();
const push = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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

  it('shows the friendly message when no provider may take a stream', async () => {
    const { LiveApiError } = jest.requireActual('@/lib/live/api');
    create.mockRejectedValue(new LiveApiError(503, 'live_budget'));
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
    fireEvent.click(screen.getByTestId('studio-live-create'));
    expect(await screen.findByTestId('studio-live-error')).toHaveTextContent(text.errors.live_budget);
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes only after the in-app confirm', async () => {
    remove.mockResolvedValue(undefined);
    render(<LiveTab locale="en" channelId="c1" role="owner" />);
    const rows = await screen.findAllByTestId('studio-live-row');
    fireEvent.click(within(rows[0]).getByTestId('studio-live-delete'));
    const dialog = await screen.findByTestId('studio-live-delete-dialog');
    expect(dialog).toHaveTextContent('"Stream a"');
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

  describe('creator tier', () => {
    const live = (over: Record<string, unknown>) => ({ status: 'ready', access: { live: { allowed: true, reason: null, unlimited: false, hoursMonth: 20, usedMinutes: 90, maxConcurrent: 1, maxStreamMinutes: 240, ...over } } });

    it('shows the month\'s usage to an owner whose tier allows live', async () => {
      mockCreator.mockReturnValue(live({}));
      render(<LiveTab locale="en" channelId="c1" role="owner" />);
      expect(await screen.findByTestId('studio-live-usage')).toHaveTextContent('1.5');
      expect(screen.getByTestId('studio-live-create')).toBeInTheDocument();
    });

    it('explains a tier without live, hides the form and links Request access to /upgrade', async () => {
      mockCreator.mockReturnValue(live({ allowed: false, reason: 'not_in_tier' }));
      render(<LiveTab locale="ar" channelId="c1" role="owner" />);
      const gate = await screen.findByTestId('studio-live-gate');
      expect(gate).toHaveAttribute('data-reason', 'not_in_tier');
      expect(gate).toHaveTextContent(text.gate.notInTierTitle);
      expect(screen.getByTestId('studio-live-request-access')).toHaveAttribute('href', '/ar/upgrade');
      expect(screen.queryByTestId('studio-live-create')).not.toBeInTheDocument();
      // The streams already made stay listed
      expect(await screen.findAllByTestId('studio-live-row')).toHaveLength(2);
    });

    it('says the month\'s hours are used, without a request link', async () => {
      mockCreator.mockReturnValue(live({ allowed: false, reason: 'hours_used', usedMinutes: 1200 }));
      render(<LiveTab locale="en" channelId="c1" role="owner" />);
      expect(await screen.findByTestId('studio-live-gate')).toHaveTextContent(text.gate.hoursUsedTitle);
      expect(screen.queryByTestId('studio-live-request-access')).not.toBeInTheDocument();
    });

    it('a channel admin sees the server\'s live_not_in_tier refusal with Request access', async () => {
      const { LiveApiError } = jest.requireActual('@/lib/live/api');
      create.mockRejectedValue(new LiveApiError(403, 'live_not_in_tier'));
      render(<LiveTab locale="en" channelId="c1" role="admin" />);
      fireEvent.change(await screen.findByTestId('studio-live-title'), { target: { value: 'Talk' } });
      fireEvent.click(screen.getByTestId('studio-live-create'));
      const error = await screen.findByTestId('studio-live-error');
      expect(error).toHaveTextContent(text.errors.live_not_in_tier);
      expect(screen.getByTestId('studio-live-request-access')).toHaveAttribute('href', '/en/upgrade');
      expect(mockCreator.mock.results.length).toBeGreaterThan(0);
    });
  });
});
