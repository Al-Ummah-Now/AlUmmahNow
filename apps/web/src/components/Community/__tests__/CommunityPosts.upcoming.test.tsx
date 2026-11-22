/**
 * The channel page is the visitor's view for its owner too: a post scheduled for later is not in the
 * channel's feed (it stays in Studio › Posts › Scheduled), even though the API returns it to managers.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { PostStatus } from '@al-ummah/shared-types';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import CommunityPosts from '../CommunityPosts';

const list = jest.fn();
jest.mock('@/lib/api/community-posts', () => ({ listCommunityPosts: (...a: unknown[]) => list(...a), getCommunityPost: jest.fn() }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en', isRTL: false }) }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'owner1' } }) }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: null }) }));
jest.mock('@/contexts/ActiveChannelContext', () => ({ useActiveChannel: () => ({ activeChannel: { channelId: 'ch1', userId: 'owner1', name: 'Al-Fajr' } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../PostCard', () => ({ __esModule: true, default: ({ post }: { post: { id: string } }) => <div data-testid={`post-${post.id}`} /> }));

const post = (id: string, extra: Record<string, unknown> = {}) => ({ id, channelId: 'ch1', userId: 'owner1', type: 'text', content: id, status: PostStatus.PUBLISHED, createdAt: '2026-11-20T10:00:00Z', ...extra });

it('leaves a post scheduled for later out of the owner\'s channel feed', async () => {
  list.mockResolvedValue({
    posts: [post('live'), post('later', { status: PostStatus.SCHEDULED, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })],
    pagination: { hasNext: false },
  });
  render(<CommunityPosts channelId="ch1" />);
  await waitFor(() => expect(screen.getByTestId('post-live')).toBeInTheDocument());
  expect(screen.queryByTestId('post-later')).toBeNull();
});
