/**
 * Every post card's time opens the post's own page (/{locale}/post/{id}, wiki AUN-SEO); the
 * permalink page opens the post with its comments shown.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import PostCard from '../PostCard';

jest.mock('../PostEngagement', () => ({ __esModule: true, default: () => null }));
jest.mock('../CommentsSection', () => ({ __esModule: true, default: () => <div data-testid="comments" /> }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
  }),
}));

const post = { id: 'p 1', channelId: 'c1', userId: 'u1', type: 'text', content: 'Hello', createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(), likes: 0, comments: 0, shares: 0, views: 0, pinned: false, status: 'published', visibility: 'public', commentsEnabled: true, channelName: 'Noor', channelVerified: false } as unknown as CommunityPost;

describe('post card permalink', () => {
  it('links its time to the post page in the page language', () => {
    render(<PostCard post={post} locale="ar" isRTL openPostLabel="فتح هذا المنشور" />);
    const link = screen.getByTestId('post-permalink');
    expect(link).toHaveAttribute('href', '/ar/post/p%201');
    expect(link).toHaveAttribute('title', 'فتح هذا المنشور');
    expect(link.querySelector('time')).toHaveAttribute('dateTime', post.createdAt);
  });

  it('an imported post says where it first came out, linking the original (TOOLS-ADMIN TA-9)', () => {
    mockLang = 'en';
    const imported = { ...post, importedFrom: { platform: 'bluesky', url: 'https://bsky.app/profile/a.bsky.social/post/3k', postedAt: '2026-11-10T09:00:00Z', sourceId: 'isrc_1' } } as CommunityPost;
    const { unmount } = render(<PostCard post={imported} />);
    const origin = screen.getByTestId('post-origin');
    expect(origin).toHaveTextContent('Originally on Bluesky');
    expect(origin).toHaveAttribute('href', 'https://bsky.app/profile/a.bsky.social/post/3k');
    expect(origin).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(origin).toHaveAttribute('title', 'Originally posted on Bluesky on November 10, 2026');
    unmount();
    mockLang = 'ar';
    const { unmount: unmountAr } = render(<PostCard post={{ ...imported, importedFrom: { platform: 'telegram', url: null, postedAt: '2026-11-10T09:00:00Z', sourceId: 'isrc_2' } } as CommunityPost} locale="ar" isRTL />);
    const ar = screen.getByTestId('post-origin');
    expect(ar.tagName).toBe('SPAN');
    expect(ar).toHaveTextContent('نُشر أولًا على تيليجرام');
    expect(ar).toHaveAttribute('title', 'نُشر أول مرة على تيليجرام في ١٠ نوفمبر ٢٠٢٦');
    unmountAr();
    render(<PostCard post={post} />);
    expect(screen.queryByTestId('post-origin')).toBeNull();
  });

  it('opens with the comments shown on the post page only', () => {
    const { unmount } = render(<PostCard post={post} />);
    expect(screen.queryByTestId('comments')).toBeNull();
    unmount();
    render(<PostCard post={post} initialShowComments />);
    expect(screen.getByTestId('comments')).toBeInTheDocument();
  });
});
