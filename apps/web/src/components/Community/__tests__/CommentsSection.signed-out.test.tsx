/**
 * #1622: a signed-out visitor on a post gets the watch page's sign-in prompt, never a comment
 * box with a guest avatar; the count uses the shared grammar («تعليق واحد», not «١ تعليق»).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CommentsSection from '../CommentsSection';
import { listPostComments } from '@/lib/api/post-comments';

let lang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    isRTL: lang === 'ar',
  }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: null }) }));
jest.mock('@/hooks/useHumanCheck', () => ({ useHumanCheck: () => ({ ensureHuman: jest.fn(), checking: false }) }));
jest.mock('@/lib/api/post-comments', () => ({ listPostComments: jest.fn(), createPostComment: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../Comment', () => ({ __esModule: true, default: () => <div data-testid="post-comment" /> }));

const one = [{ id: 'pc1', content: 'JazakAllahu khayran', createdAt: new Date().toISOString() }];

describe('CommentsSection (community post)', () => {
  beforeEach(() => {
    (listPostComments as jest.Mock).mockReset().mockResolvedValue({ success: true, comments: one, pagination: { hasNext: false } });
  });

  it('signed out: the sign-in prompt, no comment box', async () => {
    lang = 'en';
    render(<CommentsSection postChannelId="c1" postId="p1" postOwnerId="u1" commentsCount={1} commentsEnabled />);
    expect(screen.getByTestId('post-comments-sign-in')).toHaveTextContent('Sign in to join the conversation');
    expect(screen.getByRole('button', { name: 'Sign in to comment' })).toBeInTheDocument();
    expect(screen.queryByTestId('post-comment-input')).toBeNull();
    expect(screen.queryByTestId('comment-identity')).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('1 comment'));
  });

  it('signed in: the comment box', () => {
    lang = 'en';
    render(<CommentsSection postChannelId="c1" postId="p1" postOwnerId="u1" commentsCount={1} commentsEnabled userId="u2" userDisplayName="Hana Malik" />);
    expect(screen.getByTestId('post-comment-input')).toBeInTheDocument();
    expect(screen.queryByTestId('post-comments-sign-in')).toBeNull();
  });

  it.each([[1, 'تعليق واحد'], [2, 'تعليقان'], [3, '٣ تعليقات'], [11, '١١ تعليقًا']])('Arabic count %i reads «%s»', async (n, text) => {
    lang = 'ar';
    (listPostComments as jest.Mock).mockResolvedValue({ success: true, comments: Array.from({ length: n }, (_, i) => ({ ...one[0], id: `pc${i}` })), pagination: { hasNext: false } });
    render(<CommentsSection postChannelId="c1" postId="p1" postOwnerId="u1" commentsCount={n} commentsEnabled isRTL locale="ar" />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 }).textContent?.replace(/ /g, ' ')).toBe(text));
    expect(screen.getByTestId('post-comments-sign-in')).toHaveTextContent('سجل الدخول للانضمام إلى المحادثة');
  });
});
