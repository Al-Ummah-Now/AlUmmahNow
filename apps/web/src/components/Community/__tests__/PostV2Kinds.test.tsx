/**
 * PostV2 kinds on the Community tab (packages/shared-types/src/post-schema.ts): every shared fixture
 * renders, an article opens its full text in place, cards keep their alt text, link posts open
 * outside pages with nofollow, and the markdown renderer never renders HTML or unsafe links.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { POST_FIXTURES, type CommunityPost } from '@al-ummah/shared-types';
import ArticlePost from '../types/ArticlePost';
import CardsPost from '../types/CardsPost';
import LinkPost from '../types/LinkPost';
import PostMarkdown from '../types/PostMarkdown';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));

const fx = (k: keyof typeof POST_FIXTURES) => POST_FIXTURES[k] as unknown as CommunityPost;

describe('PostV2 kinds on the Community tab', () => {
  it('renders a full article with its body and a link to www', () => {
    render(<ArticlePost post={{ ...fx('article'), www: { url: 'https://www.alummahnow.net/en/articles/on-patience/', slug: 'on-patience', locale: 'en' } }} />);
    expect(screen.getByRole('heading', { name: 'On patience' })).toBeInTheDocument();
    expect(screen.getByText('Patience')).toBeInTheDocument();
    expect(screen.getByTestId('community-article-www')).toHaveAttribute('href', 'https://www.alummahnow.net/en/articles/on-patience/');
  });

  it('keeps the link-only mirror for older articles', () => {
    const post = { ...fx('article'), article: { title: 'Old', excerpt: null, coverUrl: null, url: 'https://www.alummahnow.net/en/articles/old/', locale: 'en' as const } };
    render(<ArticlePost post={post} />);
    expect(screen.getByTestId('community-article').tagName).toBe('A');
  });

  it('renders cards with their alt text and position', () => {
    render(<CardsPost post={fx('cards')} />);
    expect(screen.getByRole('region', { name: 'Three cards' })).toBeInTheDocument();
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['Fixture image 4', 'Fixture image 5', 'Fixture image 6']);
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeDisabled();
  });

  it('opens link posts outside with nofollow', () => {
    render(<LinkPost post={fx('link')} />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://example.org/page');
    expect(a.getAttribute('rel')).toContain('nofollow');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('markdown: no HTML, no javascript: links, https images only', () => {
    const { container } = render(<PostMarkdown source={'<script>x</script> **b** [bad](javascript:alert(1)) [ok](https://a.test/)\n\n![i](http://a.test/x.jpg)\n\n- one\n- two'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>x</script>');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('markdown: ::video[ID] lines link to the watch page', () => {
    const { container } = render(<PostMarkdown source={'Intro\n\n::video[abc-123]'} locale="ar" watchLabel="Watch" />);
    expect(container.querySelector('a')).toHaveAttribute('href', '/ar/video/abc-123');
  });
});
