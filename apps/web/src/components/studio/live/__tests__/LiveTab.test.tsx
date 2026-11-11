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
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), debug: jest.fn() } }));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.live;
const row = (id: string, status = 'scheduled') => ({ id, title: `Stream ${id}`, status, dateCreated: '2026-11-11T09:00:00.000Z' });

describe('Studio LiveTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
