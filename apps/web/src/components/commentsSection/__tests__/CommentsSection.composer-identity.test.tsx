/**
 * The composer shows who a comment goes under the YouTube way (owner decision 2026-11-15): only
 * the avatar of the identity you act as (your photo, or the active channel's logo), whose
 * accessible name is that identity's name. No "Commenting as" text and no Switch: identity is
 * chosen only in the header's Acting as menu.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import CommentsSection from '..';

let account: Record<string, unknown> = { user: null };

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'viewer', displayName: 'Amina', avatarUrl: '/amina.png' } }),
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
    comments: [], replies: {}, sort: 'newest', setSort: jest.fn(), commentSettings: 'on',
    addComment: jest.fn(), addReply: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn(),
    approveComment: jest.fn(), toggleLike: jest.fn(), toggleReplies: jest.fn(), loadMoreReplies: jest.fn(),
    loadMore: jest.fn(), hasMore: false, isLoading: false, isLoadingMore: false, loadError: false,
    isConnected: false, commentsCount: 0,
  }),
}));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const viewer = { id: 'viewer', email: 'viewer@test.local' } as never;

describe('comment composer identity', () => {
  it('shows your photo, named after you, with no text and no Switch even when you have channels', () => {
    account = { id: 'viewer', channel: null, channels: [{ id: 'ch1', name: 'My channel' }] };
    render(<CommentsSection videoId="v1" user={viewer} />);
    const avatar = screen.getByTestId('comment-identity');
    expect(avatar).toHaveAccessibleName('Amina');
    expect(avatar).toHaveAttribute('src', '/amina.png');
    expect(avatar).toHaveAttribute('data-as', 'member');
    expect(screen.queryByText(/Commenting as/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch/ })).toBeNull();
    expect(screen.queryByTestId('comment-identity-switch')).toBeNull();
  });

  it('shows the active channel’s logo, named in the page language', () => {
    account = { id: 'viewer', channel: { id: 'ch1', name: 'Community Corner', nameLocalized: { en: 'The Corner', ar: 'ركن المجتمع' }, avatarUrl: '/corner.png' }, channels: [{ id: 'ch1', name: 'Community Corner' }] };
    render(<CommentsSection videoId="v1" user={viewer} />);
    const avatar = screen.getByTestId('comment-identity');
    expect(avatar).toHaveAccessibleName('The Corner');
    expect(avatar).toHaveAttribute('src', '/corner.png');
    expect(avatar).toHaveAttribute('data-as', 'channel');
  });

  it('a channel without a logo shows its first letter, still named for screen readers', () => {
    account = { id: 'viewer', channel: { id: 'ch1', name: 'Community Corner' }, channels: [{ id: 'ch1', name: 'Community Corner' }] };
    render(<CommentsSection videoId="v1" user={viewer} />);
    const avatar = screen.getByRole('img', { name: 'Community Corner' });
    expect(avatar).toHaveTextContent('C');
  });
});
