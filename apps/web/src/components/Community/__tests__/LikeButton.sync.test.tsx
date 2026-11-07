/**
 * Regression: the community feed re-fetches once the viewer's active channel
 * is known; the like button must adopt the viewer-specific state from that
 * second response instead of keeping the anonymous first render.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import LikeButton from '../LikeButton';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));

jest.mock('@/lib/api/community-posts', () => ({
  likeCommunityPost: jest.fn(),
  unlikeCommunityPost: jest.fn(),
}));

describe('LikeButton', () => {
  it('follows updated like state from a re-fetched feed', () => {
    const { rerender } = render(
      <LikeButton postChannelId="c1" postId="p1" initialLikes={0} initialLiked={false} channelId="v1" userId="u1" />
    );
    expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<LikeButton postChannelId="c1" postId="p1" initialLikes={3} initialLiked={true} channelId="v1" userId="u1" />);
    const button = screen.getByRole('button', { name: 'Unlike' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('3');
  });

  it('is disabled without a signed-in viewer channel', () => {
    render(<LikeButton postChannelId="c1" postId="p1" initialLikes={1} />);
    expect(screen.getByRole('button', { name: 'Like' })).toBeDisabled();
  });
});
