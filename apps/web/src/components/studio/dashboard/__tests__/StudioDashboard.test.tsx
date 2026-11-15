import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { StudioDashboard } from '../StudioDashboard';

const counts = jest.fn();
const list = jest.fn();
const channel = jest.fn();
const video = jest.fn();
const held = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/studio/c1/dashboard',
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/lib/api/studio-content', () => ({
  getChannelContentCounts: (...args: unknown[]) => counts(...args),
  listChannelContent: (...args: unknown[]) => list(...args),
}));
const summary = jest.fn();
jest.mock('@/lib/api/studio-analytics', () => ({
  getStudioChannelAnalytics: (...args: unknown[]) => channel(...args),
  getStudioVideoAnalytics: (...args: unknown[]) => video(...args),
}));
jest.mock('@/lib/api/studio-comments', () => ({
  listHeldComments: (...args: unknown[]) => held(...args),
  getChannelCommentSummary: (...args: unknown[]) => summary(...args),
}));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.dashboard;
const ZERO = { published: 0, scheduled: 0, drafts: 0, processing: 0, in_review: 0, not_approved: 0, failed: 0 };
const day = (views: number) => ({ date: '2026-11-08', views, likes: 0, comments: 0, subscribers: 0, watchTime: 0 });
const v = (id: string, extra = {}) => ({ id, title: `Video ${id}`, views: 7, likesCount: 2, commentsCount: 1, dateCreated: '2026-01-01T00:00:00.000Z', ...extra });
const comment = (id: string) => ({
  id, kind: 'video', targetId: 'v9', targetTitle: 'Tafsir 1', targetUrlPath: '/video/v9', parentId: null, text: `Comment ${id}`, createdAt: '2026-11-15T00:00:00.000Z',
  author: { userId: 'u1', channelId: null, displayName: 'Amina Yusuf' }, status: 'held', isPinned: false, isHearted: false, repliesCount: 0, hasChannelReply: false,
});

type Role = 'owner' | 'admin' | 'editor' | 'moderator';
const show = (role: Role = 'owner', flags: { liveOn?: boolean; uploadOn?: boolean } = {}) =>
  render(<StudioDashboard locale="en" channelId="c1" role={role} {...flags} />);
const settled = async () => waitFor(() => expect(screen.getByTestId('studio-dashboard')).not.toHaveAttribute('aria-busy'));

const byStatus: Record<string, unknown[]> = {
  published: [v('latest', { studioStatus: 'published', dateCreated: '2026-11-10T00:00:00.000Z' })],
  processing: [v('proc', { studioStatus: 'processing', dateCreated: '2026-11-14T00:00:00.000Z' })],
  failed: [v('bad', { studioStatus: 'failed', dateCreated: '2026-11-12T00:00:00.000Z' })],
  in_review: [],
  not_approved: [],
  drafts: [v('d1', { studioStatus: 'drafts' })],
  scheduled: [v('late', { scheduledPublishDate: '2027-02-01T00:00:00.000Z' }), v('soon', { scheduledPublishDate: '2027-01-01T00:00:00.000Z' })],
};

describe('StudioDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    counts.mockResolvedValue({ ...ZERO, published: 3, processing: 1, failed: 2, drafts: 4, scheduled: 2 });
    list.mockImplementation(async (_c: string, q: { status: string }) => ({ items: byStatus[q.status] ?? [], cursor: null }));
    channel.mockResolvedValue({ totalViews: 500, totalSubscribers: 9, recentMetrics: [day(10)] });
    video.mockResolvedValue({ watchTime: 90 });
    held.mockResolvedValue({ items: [comment('h1'), comment('h2')], total: 7 });
    summary.mockResolvedValue({ inbox: 4, held: 2, removed: 0, recent: [{ id: 'k1', kind: 'video', targetId: 'v1', targetTitle: 'Video v1', targetUrlPath: '/video/v1', parentId: null, text: 'Great video', createdAt: '2026-11-01T00:00:00.000Z', author: { userId: 'u2', channelId: null, displayName: 'Amina' }, status: 'published', isPinned: false, isHearted: false, repliesCount: 0, hasChannelReply: false }] });
  });

  it('shows recent comments and the held count to roles that moderate', async () => {
    show('owner');
    expect(await screen.findByTestId('studio-dash-comment')).toHaveTextContent('Great video');
    expect(screen.getByTestId('studio-dash-comments-held')).toHaveAttribute('href', '/en/studio/c1/comments?tab=held');
    expect(screen.getByTestId('studio-dash-comments-all')).toHaveAttribute('href', '/en/studio/c1/comments');
  });

  it('gives a moderator the recent comments too', async () => {
    show('moderator');
    expect(await screen.findByTestId('studio-dash-comment')).toHaveTextContent('Amina');
  });

  it('shows no comments card to an editor', async () => {
    show('editor');
    await screen.findByTestId('studio-dashboard');
    expect(screen.queryByTestId('studio-dash-comments')).toBeNull();
    expect(summary).not.toHaveBeenCalled();
  });

  it('shows the latest video, totals and tasks', async () => {
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toHaveTextContent('Video latest');
    expect(await screen.findByTestId('studio-dash-totals')).toHaveTextContent('500');
    const tasks = await screen.findByTestId('studio-dash-tasks');
    expect(tasks.querySelector('a[href$="status=failed"]')).toHaveTextContent('2');
  });

  it('shows watch time on the latest video with stats access', async () => {
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toHaveTextContent('1.5 min');
  });

  it('lists recent uploads newest first, each with its processing status', async () => {
    show();
    const items = (await screen.findByTestId('studio-dash-recent')).querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual([
      `Video proc${STUDIO_EN.videos.statuses.processing}`,
      `Video bad${STUDIO_EN.videos.statuses.failed}`,
      `Video latest${STUDIO_EN.videos.statuses.published}`,
    ]);
  });

  it('shows drafts with their count, and Next scheduled soonest first', async () => {
    show();
    const drafts = await screen.findByTestId('studio-dash-drafts-list');
    expect(drafts.querySelector('a[href$="status=drafts"]')).toHaveTextContent('4');
    expect(drafts).toHaveTextContent('Video d1');
    expect(screen.getByTestId('studio-dash-next').querySelectorAll('a')[0]).toHaveTextContent('Video soon');
  });

  it('shows comments awaiting review with where they were left and how many wait in all', async () => {
    show();
    const card = await screen.findByTestId('studio-dash-held');
    expect(card).toHaveTextContent('Comment h1');
    expect(card).toHaveTextContent('Amina Yusuf');
    expect(screen.getAllByRole('link', { name: 'On Tafsir 1' })[0]).toHaveAttribute('href', '/en/video/v9');
    expect(card).toHaveTextContent('Waiting in all: 7');
    expect(held).toHaveBeenCalledWith('c1', 3);
  });

  it('keeps Recent comments on the welcome view (a channel with only posts has comments)', async () => {
    counts.mockResolvedValue(ZERO);
    list.mockResolvedValue({ items: [], cursor: null });
    show();
    expect(await screen.findByTestId('studio-dash-welcome')).toBeInTheDocument();
    expect(await screen.findByTestId('studio-dash-comments-body')).toBeInTheDocument();
  });

  it('a section with no data says so plainly', async () => {
    counts.mockResolvedValue({ ...ZERO, published: 1 });
    list.mockImplementation(async (_c: string, q: { status: string }) => ({ items: q.status === 'published' ? byStatus.published : [], cursor: null }));
    held.mockResolvedValue({ items: [], total: 0 });
    show();
    expect(await screen.findByTestId('studio-dash-held')).toHaveTextContent(text.held.none);
    expect(screen.getByTestId('studio-dash-drafts')).toHaveTextContent(text.drafts.none);
    expect(screen.getByTestId('studio-dash-tasks')).toHaveTextContent(text.tasks.none);
  });

  describe('a new channel', () => {
    beforeEach(() => {
      counts.mockResolvedValue(ZERO);
      list.mockResolvedValue({ items: [], cursor: null });
      held.mockResolvedValue({ items: [], total: 0 });
    });

    it('is invited to upload while uploads are on', async () => {
      show('owner', { uploadOn: true });
      expect(await screen.findByTestId('studio-dash-welcome')).toHaveTextContent(text.welcome.title);
      expect(screen.getByRole('link', { name: text.welcome.upload })).toHaveAttribute('href', '/en/upload?channel=c1');
      expect(screen.queryByTestId('studio-dash-totals')).toBeNull();
    });

    it('with uploads off gets no invitation, but its sections with plain empty states', async () => {
      show('owner');
      await settled();
      expect(screen.queryByTestId('studio-dash-welcome')).toBeNull();
      expect(screen.queryByText(text.welcome.body)).toBeNull();
      // Nothing uploaded and no way to upload: no Recent uploads card at all
      expect(screen.queryByTestId('studio-dash-recent')).toBeNull();
      expect(screen.queryByText(text.recent.none)).toBeNull();
      expect(screen.getByTestId('studio-dash-drafts')).toHaveTextContent(text.drafts.none);
      expect(screen.getByTestId('studio-dash-held')).toHaveTextContent(text.held.none);
      expect(screen.queryByRole('link', { name: text.quick.upload })).toBeNull();
    });
  });

  describe('every role keeps content with Live, upload and the rest off (owner review 2026-11-16)', () => {
    it.each<[Role, string[], string[]]>([
      ['owner', ['studio-dash-tasks', 'studio-dash-recent', 'studio-dash-latest', 'studio-dash-held', 'studio-dash-drafts', 'studio-dash-totals', 'studio-dash-quick'], []],
      ['admin', ['studio-dash-tasks', 'studio-dash-recent', 'studio-dash-latest', 'studio-dash-held', 'studio-dash-drafts', 'studio-dash-totals', 'studio-dash-quick'], []],
      ['editor', ['studio-dash-tasks', 'studio-dash-recent', 'studio-dash-latest', 'studio-dash-drafts', 'studio-dash-quick'], ['studio-dash-held', 'studio-dash-totals']],
      ['moderator', ['studio-dash-held'], ['studio-dash-tasks', 'studio-dash-recent', 'studio-dash-latest', 'studio-dash-drafts', 'studio-dash-totals', 'studio-dash-quick']],
    ])('%s', async (role, shown, hidden) => {
      show(role);
      await settled();
      for (const id of shown) expect(screen.getByTestId(id)).toBeInTheDocument();
      for (const id of hidden) expect(screen.queryByTestId(id)).toBeNull();
      expect(screen.queryByRole('link', { name: text.quick.upload })).toBeNull();
      expect(screen.queryByRole('link', { name: text.quick.goLive })).toBeNull();
      expect(screen.queryByTestId('studio-dash-welcome')).toBeNull();
    });

    it('a moderator never asks for videos or stats', async () => {
      show('moderator');
      await settled();
      expect(counts).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(channel).not.toHaveBeenCalled();
    });

    it('an editor never asks for stats or held comments', async () => {
      show('editor');
      expect(await screen.findByTestId('studio-dash-latest')).not.toHaveTextContent('1.5 min');
      expect(channel).not.toHaveBeenCalled();
      expect(video).not.toHaveBeenCalled();
      expect(held).not.toHaveBeenCalled();
    });
  });

  it('offers Go live only while live is on for the channel', async () => {
    const { unmount } = show();
    await screen.findByTestId('studio-dash-latest');
    expect(screen.queryByRole('link', { name: text.quick.goLive })).toBeNull();
    unmount();
    show('owner', { liveOn: true });
    expect(await screen.findByRole('link', { name: text.quick.goLive })).toHaveAttribute('href', '/en/studio/c1/content/live');
  });

  it('offers Upload only while uploads are on for the channel', async () => {
    const { unmount } = show();
    await screen.findByTestId('studio-dash-latest');
    expect(screen.queryByRole('link', { name: text.quick.upload })).toBeNull();
    unmount();
    show('owner', { uploadOn: true });
    expect(await screen.findByRole('link', { name: text.quick.upload })).toHaveAttribute('href', '/en/upload?channel=c1');
  });

  it('keeps the other cards when one fails, and offers Retry', async () => {
    channel.mockResolvedValue(null);
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: text.retry })).toBeInTheDocument();
  });

  describe('the loading state always ends (owner review 2026-11-16: no endless spinners)', () => {
    const everyCall = (impl: () => Promise<unknown>) => {
      for (const fn of [counts, list, channel, video, held]) fn.mockImplementation(impl);
    };

    it.each<[string, () => Promise<unknown>]>([
      // The Server Actions answer null for any refused call: feature_off and 404 included
      ['feature_off', async () => null],
      ['404', async () => null],
      ['a server error', () => Promise.reject(new Error('500 Internal Server Error'))],
      ['a call that never completed (rejected)', () => Promise.reject(new TypeError('Failed to fetch'))],
      ['a cancelled call', () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))],
      ['a call that throws before it starts', () => {
        throw new Error('boom');
      }],
    ])('on %s: every card shows its failure, and Retry loads again', async (_name, impl) => {
      everyCall(impl);
      show();
      await settled();
      expect(screen.queryAllByRole('button', { name: text.retry }).length).toBeGreaterThanOrEqual(4);
      expect(screen.queryByTestId('studio-dash-latest')).toBeNull();

      for (const fn of [counts, list, channel, video, held]) fn.mockReset();
      counts.mockResolvedValue({ ...ZERO, published: 1 });
      list.mockImplementation(async (_c: string, q: { status: string }) => ({ items: byStatus[q.status] ?? [], cursor: null }));
      channel.mockResolvedValue({ totalViews: 1, totalSubscribers: 1, recentMetrics: [day(1)] });
      video.mockResolvedValue({ watchTime: 0 });
      held.mockResolvedValue({ items: [], total: 0 });
      fireEvent.click(screen.getAllByRole('button', { name: text.retry })[0]!);
      expect(await screen.findByTestId('studio-dash-latest')).toBeInTheDocument();
      await settled();
      expect(screen.queryByRole('button', { name: text.retry })).toBeNull();
    });

    it('a moderator with comments unreachable gets the failure, not a void', async () => {
      held.mockResolvedValue(null);
      show('moderator');
      await settled();
      expect(screen.getByTestId('studio-dash-held')).toHaveTextContent(text.cardFailed);
    });

    it('leaving mid-load drops the late answer without updating an unmounted page', async () => {
      let finish: (value: unknown) => void = () => undefined;
      counts.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { unmount } = show();
      expect(screen.getByTestId('studio-dashboard')).toHaveAttribute('aria-busy', 'true');
      unmount();
      await act(async () => finish({ ...ZERO }));
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });
});
