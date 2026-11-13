/**
 * #1151: a signed-in member without a channel comments, replies and likes
 * video comments as themselves. The composer used to be replaced by "No
 * active channel selected" and every like button was disabled.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentsSection from '..';

let account: { user: { id: string } | null; channel?: { id: string; name: string; avatarUrl?: string } | null } = { user: null };
const addComment = jest.fn(async () => ({ ok: true, held: false }));
const toggleLike = jest.fn(async () => true);

const comment = {
  id: 'c1',
  videoId: 'v1',
  userId: 'someone',
  channelId: 'their-ch',
  text: 'A comment',
  dateCreated: '2026-11-13T00:00:00Z',
  dateModified: '2026-11-13T00:00:00Z',
  likesCount: 2,
  dislikesCount: 0,
  repliesCount: 0,
  isLiked: false,
  isDisliked: false,
  isEdited: false,
  isDeleted: false,
  isPinned: false,
  isHeld: false,
  parentCommentId: null,
  author: { userId: 'someone', channelId: 'their-ch', displayName: 'Their channel' },
};

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'viewer', displayName: '', firstName: 'Amina', lastName: 'Yusuf', avatarUrl: '/amina.png' } }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    isRTL: false,
    dir: 'ltr',
  }),
}));
jest.mock('@/hooks/useRealTimeComments', () => ({
  useRealTimeComments: () => ({
    comments: [comment],
    replies: {},
    sort: 'newest',
    setSort: jest.fn(),
    commentSettings: 'on',
    addComment,
    addReply: jest.fn(async () => ({ ok: true, held: false })),
    updateComment: jest.fn(async () => true),
    deleteComment: jest.fn(async () => true),
    approveComment: jest.fn(async () => true),
    toggleLike,
    toggleReplies: jest.fn(),
    loadMoreReplies: jest.fn(),
    loadMore: jest.fn(),
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    loadError: false,
    isConnected: true,
    commentsCount: 1,
  }),
}));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const viewer = { id: 'viewer', email: 'viewer@test.local' } as never;

describe('CommentsSection without a channel (#1151)', () => {
  beforeEach(() => {
    addComment.mockClear();
    toggleLike.mockClear();
  });

  it('shows the composer as the member, posts and likes; no "select a channel" prompt', async () => {
    account = { user: { id: 'viewer' }, channel: null };
    render(<CommentsSection videoId="v1" user={viewer} />);

    expect(screen.queryByText(/No active channel selected/i)).toBeNull();
    expect(screen.getByTestId('comment-identity')).toHaveTextContent('Commenting as Amina Yusuf');
    expect(screen.getByTestId('comment-identity')).toHaveAttribute('data-as', 'member');

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Barak Allahu feek' } });
    fireEvent.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect(addComment).toHaveBeenCalledWith('Barak Allahu feek'));

    const like = screen.getByRole('button', { name: 'Like 2' });
    expect(like).toBeEnabled();
    fireEvent.click(like);
    await waitFor(() => expect(toggleLike).toHaveBeenCalledWith('c1'));
    expect(screen.getByTestId('comment-reply-button')).toBeInTheDocument();
  });

  it('with a channel active the composer says it posts as the channel', () => {
    account = { user: { id: 'viewer' }, channel: { id: 'my-ch', name: 'My channel' } };
    render(<CommentsSection videoId="v1" user={viewer} />);
    expect(screen.getByTestId('comment-identity')).toHaveTextContent('Commenting as My channel');
    expect(screen.getByTestId('comment-identity')).toHaveAttribute('data-as', 'channel');
  });

  it('signed out still asks to sign in and cannot like', () => {
    account = { user: null };
    render(<CommentsSection videoId="v1" user={null} />);
    expect(screen.queryByTestId('comment-input')).toBeNull();
    expect(screen.getByText('Sign in to join the conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Like 2' })).toBeDisabled();
  });
});
