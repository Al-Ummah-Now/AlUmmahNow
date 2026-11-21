/**
 * The post card's action row (owner review: pale counts on a gold pill). Every count and icon uses
 * one of the two text roles `pnpm check:tokens` holds to WCAG AA on every surface of every theme:
 * text-secondary (idle) or link (active). No fills, no theme-blind greys or blues, no primary as text
 * (primary is a fill colour, unchecked as text). COMM-015 measures the rendered pixels end to end.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import PostCard from '../PostCard';

jest.mock('../CommentsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/en/channels/c1' }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: { id: 'viewer' } }), useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/services/api/library', () => ({ LibraryService: { getSavedPostIds: jest.fn(async () => []), isPostSaved: jest.fn(async () => false), savePost: jest.fn(), unsavePost: jest.fn() } }));

const ALLOWED = ['text-[var(--fanous-color-text-secondary)]', 'text-[var(--fanous-color-link)]'];
const FORBIDDEN = /\b(?:dark:)?text-(?:gray|blue|slate|yellow|amber)-\d+|text-\[var\(--fanous-color-primary\)\]|(?:^|\s)bg-(?:blue|gray|primary|\[var\(--fanous-color-primary)/;

const post = (liked: boolean) => ({
  id: 'p1', channelId: 'c1', userId: 'u1', type: 'text', content: 'Hello', createdAt: new Date().toISOString(),
  likes: liked ? 3 : 0, comments: 2, shares: 1, views: 40, viewerHasLiked: liked, pinned: false, status: 'published', visibility: 'public', commentsEnabled: true,
}) as unknown as CommunityPost;

describe.each([
  ['idle', false],
  ['active', true],
] as const)('action row colours (%s)', (_state, active) => {
  it('every count and icon uses an AA-checked text token, never a fill', () => {
    render(<PostCard post={post(active)} userId="viewer" channelId="ch-v" initialShowComments={active} />);
    const row = screen.getByTestId('post-actions-row');
    const marks = [...row.querySelectorAll<HTMLElement | SVGElement>('svg, span')].filter(
      (el) => el.tagName.toLowerCase() === 'svg' || (/\d/.test(el.textContent ?? '') && !el.classList.contains('sr-only') && !el.querySelector('span')),
    );
    expect(marks.length).toBeGreaterThan(4);
    for (const el of marks) {
      // Its own colour class, or the nearest one it inherits
      let node: Element | null = el;
      let cls = '';
      while (node && node !== row) {
        cls = node.getAttribute('class') ?? '';
        if (ALLOWED.some((a) => cls.includes(a)) || FORBIDDEN.test(cls)) break;
        node = node.parentElement;
      }
      expect({ el: el.outerHTML.slice(0, 80), cls }).toEqual({ el: el.outerHTML.slice(0, 80), cls: expect.not.stringMatching(FORBIDDEN) });
      expect(ALLOWED.some((a) => cls.includes(a))).toBe(true);
    }
    // No filled pill behind a button
    for (const b of row.querySelectorAll('button')) expect(b.className).not.toMatch(/(?:^|\s)bg-(?!transparent)/);
  });
});
