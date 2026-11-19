/**
 * #1634: the Library's playlist cards and saved-post cards sit on the shared card surface (`.c`:
 * frosted glass, golden edge; theme/system.css), never a bare border the theme background shows
 * through. `group` gives them the site's link-card hover.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { userId: 'u1', channel: { id: 'ch1' } } }) }));
jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock('@/components/VideoThumbnail', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/services/api/watch-history', () => ({ WatchHistoryService: { list: jest.fn().mockResolvedValue({ entries: [], total: 0 }) } }));
jest.mock('@/services/api/library', () => ({
  LibraryService: {
    watchLater: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    liked: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    savedPosts: jest.fn().mockResolvedValue({
      items: [{ id: 'p1', channelId: 'ch2', channelName: 'Morning Adhkar', content: '<p>Remember Allah often.</p>' }],
      total: 1,
    }),
  },
}));
jest.mock('@/lib/api/playlists', () => ({
  listPlaylists: jest.fn().mockResolvedValue({ data: [{ id: 'pl1', name: 'Friday reminders', videos: [] }] }),
}));

import { LibraryHubView } from '../LibraryHub';
import { SavedPostCard } from '../SavedPostCard';

const onSurface = (el: HTMLElement) => {
  expect(el).toHaveClass('c');
  expect(el).toHaveClass('group');
  // The old bare-border look is gone
  expect(el.className).not.toMatch(/\bborder-gray-200\b/);
};

describe('Library cards on the shared surface (#1634)', () => {
  it('playlist and saved-post cards on the Library hub', async () => {
    render(<LibraryHubView dir="ltr" />);
    onSurface(await screen.findByTestId('library-playlist'));
    onSurface(await screen.findByTestId('library-saved-post'));
  });

  it('a saved-post card on its own (the saved posts page)', () => {
    render(<SavedPostCard post={{ id: 'p1', channelId: 'ch2', channelName: 'Morning Adhkar', content: 'Remember Allah often.' } as never} />);
    onSurface(screen.getByTestId('library-saved-post'));
  });

  it('a saved post takes its own text direction (an Arabic post on the English page)', () => {
    render(<SavedPostCard post={{ id: 'p2', channelId: 'ch2', channelName: 'Evening Adhkar Circle', content: 'تبدأ سلسلتنا الجديدة يوم الجمعة.' } as never} />);
    expect(screen.getByText('تبدأ سلسلتنا الجديدة يوم الجمعة.')).toHaveAttribute('dir', 'auto');
  });
});
