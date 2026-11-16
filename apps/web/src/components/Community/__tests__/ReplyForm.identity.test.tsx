/**
 * A reply goes under the identity you act as: the reply form shows YOUR avatar (named after you),
 * never the avatar of the person you reply to (bug fixed 2026-11-15), and no "Commenting as" text.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Comment from '../Comment';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman: jest.fn().mockResolvedValue({ ok: true }) }) }));
jest.mock('@/lib/api/post-comments', () => ({}));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const theirs = {
  id: 'c1', postId: 'p1', channelId: 'their-ch', userId: 'other', userDisplayName: 'Omar Khalid', userAvatarUrl: '/omar.png',
  content: 'Great post', likesCount: 0, repliesCount: 0, isLiked: false, isPinned: false, isHearted: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as never;

describe('reply form identity', () => {
  it('shows the viewer’s acting identity, not the replied-to author', () => {
    render(<Comment comment={theirs} postChannelId="their-ch" postId="p1" userId="viewer" channelId="my-ch" viewerAvatar="/my-logo.png" viewerName="My channel" />);
    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }));
    const avatar = screen.getByTestId('comment-identity');
    expect(avatar).toHaveAccessibleName('My channel');
    expect(avatar).toHaveAttribute('src', '/my-logo.png');
    expect(avatar).toHaveAttribute('data-as', 'channel');
    expect(screen.queryByText(/Commenting as/)).toBeNull();
  });
});
