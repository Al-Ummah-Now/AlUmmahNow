/**
 * A post comment posted as the member links its author to their public profile (the API adds
 * `userHandle`); a channel's comment, a handle-less member and a deleted comment do not.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PostComment } from '@al-ummah/shared-types';
import Comment from '../Comment';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/api/post-comments', () => ({ listCommentReplies: jest.fn().mockResolvedValue({ success: true, comments: [] }) }));
jest.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img {...props} />,
}));

const comment = (over: Partial<PostComment> = {}): PostComment => ({
  id: 'c1', postId: 'p1', channelId: 'u1', userId: 'u1', content: 'Salam', userDisplayName: 'Sara', userAvatarUrl: 'https://img.test/a.jpg',
  channelVerified: false, likes: 0, repliesCount: 0, isPinned: false, isEdited: false, isHeartedByCreator: false, createdAt: new Date().toISOString(),
  ...over,
} as PostComment);

describe('post comment author link', () => {
  it('links the name and the avatar to /u/@handle', () => {
    render(<Comment comment={comment({ userHandle: 'sara' })} postChannelId="ch" postId="p1" />);
    expect(screen.getByTestId('post-comment-author-link')).toHaveAttribute('href', '/en/u/@sara');
    expect(screen.getByTestId('post-comment-author-link')).toHaveTextContent('Sara');
    const avatar = screen.getByTestId('post-comment-author-avatar-link');
    expect(avatar).toHaveAttribute('href', '/en/u/@sara');
    expect(avatar).toHaveAttribute('tabindex', '-1');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });

  it('no handle (a channel comment, or a member without a public profile): no link', () => {
    render(<Comment comment={comment()} postChannelId="ch" postId="p1" />);
    expect(screen.queryByTestId('post-comment-author-link')).toBeNull();
    expect(screen.queryByTestId('post-comment-author-avatar-link')).toBeNull();
  });

  it('a deleted comment never links', () => {
    render(<Comment comment={comment({ userHandle: 'sara', deletedAt: new Date().toISOString() } as Partial<PostComment>)} postChannelId="ch" postId="p1" />);
    expect(screen.queryByTestId('post-comment-author-link')).toBeNull();
  });
});
