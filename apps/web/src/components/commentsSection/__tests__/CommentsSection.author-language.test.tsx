/**
 * #1610: a comment posted as a channel named the channel in English on Arabic pages. The author
 * shows in the page language, falling back to the default name when that language has none.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import CommentsSection from '..';

let account: Record<string, unknown> = { user: null };
let lang: 'en' | 'ar' = 'ar';
let comments: unknown[] = [];

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'viewer', displayName: 'Amina', avatarUrl: '/amina.png' } }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    isRTL: lang === 'ar',
    dir: lang === 'ar' ? 'rtl' : 'ltr',
  }),
}));
jest.mock('@/hooks/useRealTimeComments', () => ({
  useRealTimeComments: () => ({
    comments, replies: {}, sort: 'newest', setSort: jest.fn(), commentSettings: 'on',
    addComment: jest.fn(), addReply: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn(),
    approveComment: jest.fn(), toggleLike: jest.fn(), toggleReplies: jest.fn(), loadMoreReplies: jest.fn(),
    loadMore: jest.fn(), hasMore: false, isLoading: false, isLoadingMore: false, loadError: false,
    isConnected: false, commentsCount: comments.length,
  }),
}));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const viewer = { id: 'viewer', email: 'viewer@test.local' } as never;
const comment = (id: string, author: Record<string, unknown>) => ({
  id, userId: 'u-' + id, videoId: 'v1', text: 'Thank you', dateCreated: '2026-11-19T00:00:00Z', dateModified: '2026-11-19T00:00:00Z',
  likesCount: 0, repliesCount: 0, isPinned: false, author: { userId: 'u-' + id, channelId: null, ...author },
});

describe('comment authors in the page language', () => {
  beforeEach(() => { account = { id: 'viewer', channel: null, channels: [] }; });

  it("Arabic page: a channel's Arabic name; one without an Arabic name keeps its default", () => {
    lang = 'ar';
    comments = [
      comment('c1', { channelId: 'ch1', displayName: 'Community Corner', displayNameLocalized: { en: 'Community Corner', ar: 'ركن المجتمع' } }),
      comment('c2', { channelId: 'ch2', displayName: 'Weekend Sessions' }),
    ];
    render(<CommentsSection videoId="v1" user={viewer} />);
    expect(screen.getByText('ركن المجتمع')).toBeInTheDocument();
    expect(screen.queryByText('Community Corner')).toBeNull();
    expect(screen.getByText('Weekend Sessions')).toBeInTheDocument();
  });

  it('English page: the English name', () => {
    lang = 'en';
    comments = [comment('c1', { channelId: 'ch1', displayName: 'ركن المجتمع', displayNameLocalized: { en: 'Community Corner', ar: 'ركن المجتمع' } })];
    render(<CommentsSection videoId="v1" user={viewer} />);
    expect(screen.getByText('Community Corner')).toBeInTheDocument();
  });
});
