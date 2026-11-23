/**
 * The Studio post list's ⋮ menu opens over the next card: it is opaque (menu-solid), so that card's
 * text never shows through it (owner review frames, ar desktop).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';

jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }),
}));

import { PostCard } from '../PostCard';

const post = {
  id: 'p1', channelId: 'c1', userId: 'u1', type: 'text', content: 'Reminder: the tafsir circle meets on Thursday after Maghrib.',
  createdAt: new Date(Date.now() - 3600_000).toISOString(), likes: 0, comments: 0, shares: 0, views: 0, pinned: false,
  status: 'published', visibility: 'public', commentsEnabled: true, channelName: 'Al-Fajr Reminders', channelVerified: false,
} as unknown as CommunityPost;

it('the Studio post menu is opaque', async () => {
  render(<PostCard post={post} locale="en" onView={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn(async () => undefined)} />);
  fireEvent.keyDown(screen.getByTestId('post-actions'), { key: 'Enter' });
  expect(await screen.findByRole('menu')).toHaveClass('menu-solid');
});
