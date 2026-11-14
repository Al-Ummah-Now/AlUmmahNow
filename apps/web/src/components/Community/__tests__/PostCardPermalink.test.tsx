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

const post = { id: 'p 1', channelId: 'c1', userId: 'u1', type: 'text', content: 'Hello', createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(), likes: 0, comments: 0, shares: 0, views: 0, pinned: false, status: 'published', visibility: 'public', commentsEnabled: true, channelName: 'Noor', channelVerified: false } as unknown as CommunityPost;

describe('post card permalink', () => {
  it('links its time to the post page in the page language', () => {
    render(<PostCard post={post} locale="ar" isRTL openPostLabel="فتح هذا المنشور" />);
    const link = screen.getByTestId('post-permalink');
    expect(link).toHaveAttribute('href', '/ar/post/p%201');
    expect(link).toHaveAttribute('title', 'فتح هذا المنشور');
    expect(link.querySelector('time')).toHaveAttribute('dateTime', post.createdAt);
  });

  it('opens with the comments shown on the post page only', () => {
    const { unmount } = render(<PostCard post={post} />);
    expect(screen.queryByTestId('comments')).toBeNull();
    unmount();
    render(<PostCard post={post} initialShowComments />);
    expect(screen.getByTestId('comments')).toBeInTheDocument();
  });
});
