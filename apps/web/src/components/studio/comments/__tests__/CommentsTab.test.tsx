import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { CommentsTab, MAX_COMMENT_SELECTION, parseCommentTab, parseCommentTarget } from '../CommentsTab';
import type { StudioComment } from '@/lib/api/studio-comments';

const list = jest.fn();
const act = jest.fn();
const blocks = jest.fn();
const block = jest.fn();
const unblock = jest.fn();
const videoReply = jest.fn();
const postReply = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockT }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: (p: { contentId: string }) => <div data-testid="report-dialog">{p.contentId}</div> }));
jest.mock('@/lib/api/studio-comments', () => ({
  listChannelComments: (...a: unknown[]) => list(...a),
  actOnComments: (...a: unknown[]) => act(...a),
  listChannelBlocks: (...a: unknown[]) => blocks(...a),
  blockFromChannel: (...a: unknown[]) => block(...a),
  unblockFromChannel: (...a: unknown[]) => unblock(...a),
}));
jest.mock('@/lib/api/video-comments', () => ({ createComment: (...a: unknown[]) => videoReply(...a) }));
jest.mock('@/lib/api/post-comments', () => ({ createPostComment: (...a: unknown[]) => postReply(...a) }));

const mockT = { studio: STUDIO_EN, common: { loading: 'Loading', cancel: 'Cancel' } };
const text = STUDIO_EN.commentsPage;

const c = (id: string, extra: Partial<StudioComment> = {}): StudioComment => ({
  id, kind: 'video', targetId: 'v1', targetTitle: 'First video', targetUrlPath: '/video/v1', parentId: null,
  text: `Comment ${id}`, createdAt: '2026-11-01T00:00:00.000Z', author: { userId: `u-${id}`, channelId: null, displayName: `Person ${id}` },
  status: 'published', isPinned: false, isHearted: false, repliesCount: 0, hasChannelReply: false, ...extra,
});

const show = (tab: 'inbox' | 'held' | 'removed' = 'inbox', role: 'owner' | 'moderator' = 'owner', target?: string) =>
  render(<CommentsTab locale="en" channel={{ id: 'ch1', name: 'My channel' }} role={role} tab={tab} target={target} />);

const rows = async () => screen.findAllByTestId('studio-comment');

describe('CommentsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    list.mockResolvedValue({ items: [c('a'), c('b', { kind: 'post', targetId: 'p1', targetTitle: 'A post', targetUrlPath: '/channels/ch1?tab=community' })], nextCursor: null, total: 2 });
    act.mockImplementation(async (_ch: string, _a: string, items: Array<{ commentId: string }>) => items.map((i) => ({ commentId: i.commentId, ok: true })));
  });

  it('parses the tab and target from the URL', () => {
    expect(parseCommentTab('held')).toBe('held');
    expect(parseCommentTab('nope')).toBe('inbox');
    expect(parseCommentTarget('video:v1')).toBe('video:v1');
    expect(parseCommentTarget('evil:<x>')).toBeUndefined();
  });

  it('lists the inbox with the video or post each comment is on', async () => {
    show();
    const [first, second] = await rows();
    expect(list).toHaveBeenCalledWith('ch1', expect.objectContaining({ tab: 'inbox', limit: 20 }));
    expect(first).toHaveTextContent('Comment a');
    expect(within(first).getByRole('link', { name: /First video/ })).toHaveAttribute('href', '/en/video/v1');
    expect(second).toHaveTextContent(text.post);
    expect(screen.getByTestId('studio-comments-tab-inbox')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('studio-comments-tab-held')).toHaveAttribute('href', '/en/studio/ch1/comments?tab=held');
  });

  it('shows each tab\'s empty text', async () => {
    list.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    show('removed');
    expect(await screen.findByTestId('studio-comments-empty')).toHaveTextContent(text.empty.removed);
  });

  it('says when the list could not load and retries', async () => {
    list.mockResolvedValueOnce(null);
    show();
    await userEvent.click(within(await screen.findByTestId('studio-comments-error')).getByRole('button', { name: text.retry }));
    expect(await rows()).toHaveLength(2);
  });

  it('filters by no channel reply and links', async () => {
    show();
    await rows();
    await userEvent.click(screen.getByTestId('studio-comments-filter-noreply'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('ch1', expect.objectContaining({ noReply: true, hasLink: false })));
    await userEvent.click(screen.getByTestId('studio-comments-filter-link'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('ch1', expect.objectContaining({ noReply: true, hasLink: true })));
  });

  it('removes a comment after confirming, and it leaves the list', async () => {
    show();
    const [first] = await rows();
    await userEvent.click(within(first).getByTestId('studio-comment-remove'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(text.removeConfirm.body);
    await userEvent.click(within(dialog).getByRole('button', { name: text.removeConfirm.confirm }));
    await waitFor(() => expect(screen.getAllByTestId('studio-comment')).toHaveLength(1));
    expect(act).toHaveBeenCalledWith('ch1', 'remove', [{ kind: 'video', targetId: 'v1', commentId: 'a' }]);
    expect(screen.getByTestId('studio-comments-notice')).toHaveTextContent(text.done.remove);
  });

  it('approves held comments, but not ones site moderation held', async () => {
    list.mockResolvedValue({ items: [c('h1', { status: 'held' }), c('h2', { status: 'held', heldBy: 'moderation' })], nextCursor: null, total: 2 });
    show('held');
    const [mine, moderated] = await rows();
    expect(within(moderated).queryByTestId('studio-comment-approve')).toBeNull();
    expect(within(moderated).queryByTestId('studio-comment-select')).toBeNull();
    expect(moderated).toHaveTextContent(text.heldByModeration);
    await userEvent.click(within(mine).getByTestId('studio-comment-approve'));
    await waitFor(() => expect(screen.getAllByTestId('studio-comment')).toHaveLength(1));
    expect(act).toHaveBeenCalledWith('ch1', 'approve', [{ kind: 'video', targetId: 'v1', commentId: 'h1' }]);
  });

  it('explains held_by_moderation from the API', async () => {
    list.mockResolvedValue({ items: [c('h1', { status: 'held' })], nextCursor: null, total: 1 });
    act.mockResolvedValue([{ commentId: 'h1', ok: false, error: 'held_by_moderation' }]);
    show('held');
    await userEvent.click(within((await rows())[0]).getByTestId('studio-comment-approve'));
    await waitFor(() => expect(screen.getByTestId('studio-comments-notice')).toHaveTextContent(text.errors.held_by_moderation));
    expect(screen.getAllByTestId('studio-comment')).toHaveLength(1);
  });

  it('restores removed comments and says who removed them', async () => {
    list.mockResolvedValue({ items: [c('r1', { status: 'removed', removedAt: '2026-11-02T00:00:00.000Z', removedBy: { userId: 'm', displayName: 'Mod Name' } })], nextCursor: null, total: 1 });
    show('removed');
    const [row] = await rows();
    expect(within(row).getByTestId('studio-comment-removed-by')).toHaveTextContent('Mod Name');
    await userEvent.click(within(row).getByTestId('studio-comment-restore'));
    await waitFor(() => expect(screen.queryAllByTestId('studio-comment')).toHaveLength(0));
    expect(act).toHaveBeenCalledWith('ch1', 'restore', expect.any(Array));
  });

  it('acts on a selection in bulk and reports the result', async () => {
    act.mockResolvedValue([{ commentId: 'a', ok: true }, { commentId: 'b', ok: false, error: 'not_found' }]);
    show();
    await rows();
    await userEvent.click(screen.getByTestId('studio-comments-select-all'));
    expect(screen.getByTestId('studio-comments-bulk-bar')).toHaveTextContent('2 selected');
    expect(screen.queryByTestId('studio-comments-bulk-approve')).toBeNull();
    await userEvent.click(screen.getByTestId('studio-comments-bulk-remove'));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: text.removeConfirm.confirm }));
    await waitFor(() => expect(screen.getByTestId('studio-comments-notice')).toHaveTextContent('1 done, 1 failed.'));
    expect(screen.getAllByTestId('studio-comment')).toHaveLength(1);
  });

  it('selects at most the bulk limit', async () => {
    list.mockResolvedValue({ items: Array.from({ length: MAX_COMMENT_SELECTION + 5 }, (_, i) => c(`n${i}`)), nextCursor: null, total: 55 });
    show();
    await rows();
    await userEvent.click(screen.getByTestId('studio-comments-select-all'));
    expect(screen.getByTestId('studio-comments-bulk-bar')).toHaveTextContent(`${MAX_COMMENT_SELECTION} selected`);
  });

  it('pins one comment per video and hearts', async () => {
    list.mockResolvedValue({ items: [c('a', { isPinned: true }), c('b')], nextCursor: null, total: 2 });
    show();
    const [, second] = await rows();
    await userEvent.click(within(second).getByTestId('studio-comment-more'));
    await userEvent.click(await screen.findByTestId('studio-comment-pin'));
    await waitFor(() => expect(within(screen.getAllByTestId('studio-comment')[1]).getByTestId('studio-comment-pinned')).toBeInTheDocument());
    expect(within(screen.getAllByTestId('studio-comment')[0]).queryByTestId('studio-comment-pinned')).toBeNull();
    await userEvent.click(within(screen.getAllByTestId('studio-comment')[0]).getByTestId('studio-comment-more'));
    await userEvent.click(await screen.findByTestId('studio-comment-heart'));
    await waitFor(() => expect(within(screen.getAllByTestId('studio-comment')[0]).getByTestId('studio-comment-hearted')).toBeInTheDocument());
    expect(act).toHaveBeenCalledWith('ch1', 'heart', [{ kind: 'video', targetId: 'v1', commentId: 'a' }]);
  });

  it('replies as the channel under the top-level comment', async () => {
    videoReply.mockResolvedValue({ ok: true });
    postReply.mockResolvedValue({ success: true });
    list.mockResolvedValue({ items: [c('a'), c('r', { kind: 'post', targetId: 'p1', parentId: 'top' })], nextCursor: null, total: 2 });
    show();
    const [first, reply] = await rows();
    await userEvent.click(within(first).getByTestId('studio-comment-reply'));
    expect(within(first).getByLabelText(/Reply as/)).toBeInTheDocument();
    await userEvent.type(within(first).getByTestId('studio-comment-reply-text'), 'Thanks');
    await userEvent.click(within(first).getByTestId('studio-comment-reply-send'));
    await waitFor(() => expect(videoReply).toHaveBeenCalledWith('v1', 'Thanks', 'ch1', 'a'));
    expect(screen.getByTestId('studio-comments-notice')).toHaveTextContent(text.reply.sent);
    await userEvent.click(within(reply).getByTestId('studio-comment-reply'));
    await userEvent.type(within(reply).getByTestId('studio-comment-reply-text'), 'Ok');
    await userEvent.click(within(reply).getByTestId('studio-comment-reply-send'));
    await waitFor(() => expect(postReply).toHaveBeenCalledWith('ch1', 'p1', { content: 'Ok', parentCommentId: 'top' }, { channelId: 'ch1' }));
  });

  it('blocks the author after confirming and lists blocked people with Unblock', async () => {
    block.mockResolvedValue(true);
    blocks.mockResolvedValue([{ userId: 'u-a', displayName: 'Person a', blockedAt: '2026-11-03T00:00:00.000Z' }]);
    unblock.mockResolvedValue(true);
    show();
    const [first] = await rows();
    await userEvent.click(within(first).getByTestId('studio-comment-more'));
    await userEvent.click(await screen.findByTestId('studio-comment-block'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Block Person a from this channel?');
    await userEvent.click(within(dialog).getByRole('button', { name: text.blockConfirm.confirm }));
    await waitFor(() => expect(block).toHaveBeenCalledWith('ch1', 'u-a'));
    await userEvent.click(screen.getByTestId('studio-comments-blocks'));
    await userEvent.click(within(await screen.findByTestId('studio-block')).getByTestId('studio-unblock'));
    await waitFor(() => expect(screen.getByTestId('studio-blocks-empty')).toBeInTheDocument());
    expect(unblock).toHaveBeenCalledWith('ch1', 'u-a');
  });

  it('opens the report dialog for a comment', async () => {
    show();
    const [first] = await rows();
    await userEvent.click(within(first).getByTestId('studio-comment-more'));
    await userEvent.click(await screen.findByTestId('studio-comment-report'));
    expect(screen.getByTestId('report-dialog')).toHaveTextContent('a');
  });

  it('shows only one target and links back to everything', async () => {
    show('inbox', 'owner', 'video:v1');
    await rows();
    expect(list).toHaveBeenCalledWith('ch1', expect.objectContaining({ target: 'video:v1' }));
    expect(screen.getByTestId('studio-comments-target')).toHaveTextContent('First video');
    expect(within(screen.getByTestId('studio-comments-target')).getByRole('link')).toHaveAttribute('href', '/en/studio/ch1/comments?tab=inbox');
  });

  it('tells the viewer while the channel is being indexed', async () => {
    list.mockResolvedValue({ items: [], nextCursor: null, total: 0, indexing: true });
    show();
    expect(await screen.findByTestId('studio-comments-indexing')).toHaveTextContent(text.indexing);
  });

  it('loads more pages', async () => {
    list.mockResolvedValueOnce({ items: [c('a')], nextCursor: 'next', total: 2 }).mockResolvedValueOnce({ items: [c('b')], nextCursor: null, total: 2 });
    show();
    await rows();
    await userEvent.click(screen.getByTestId('studio-comments-more'));
    await waitFor(() => expect(screen.getAllByTestId('studio-comment')).toHaveLength(2));
    expect(list).toHaveBeenLastCalledWith('ch1', expect.objectContaining({ cursor: 'next' }));
  });
});
