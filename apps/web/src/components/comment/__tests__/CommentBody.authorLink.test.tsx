/**
 * A comment's author links to their public profile only when the comment carries one (owner,
 * 2026-11-14: "only way you reach a user profile is if he comments on a video or post").
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CommentBody } from '../CommentBody';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));

const base = { dir: 'ltr' as const, author: 'Sara', text: 'Salam', time: '1h', avatar: 'https://img.test/a.jpg' };

describe('CommentBody author link', () => {
  it('links the name (one keyboard stop) and the avatar to the profile', () => {
    render(<CommentBody {...base} authorHref="/en/u/@sara" />);
    expect(screen.getByRole('link', { name: 'Sara' })).toHaveAttribute('href', '/en/u/@sara');
    // The avatar link is pointer-only: hidden from assistive tech and out of the tab order
    const avatar = screen.getByTestId('comment-author-avatar-link');
    expect(avatar).toHaveAttribute('href', '/en/u/@sara');
    expect(avatar).toHaveAttribute('tabindex', '-1');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('without a profile there is no link and the avatar keeps its alt text', () => {
    render(<CommentBody {...base} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByAltText(/Sara/)).toBeInTheDocument();
  });

  it('the comment text takes its own direction (an English comment keeps its full stop at the end on Arabic pages)', () => {
    render(<CommentBody {...base} dir="rtl" text="This recitation is beautiful." />);
    expect(screen.getByTestId('comment-text')).toHaveAttribute('dir', 'auto');
  });
});
