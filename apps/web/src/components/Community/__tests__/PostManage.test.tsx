/**
 * Story 29.4 on the post card: only the owner gets Edit and Delete (no dead menu for anyone else),
 * Delete asks in the in-app dialog and removes the post, a failure says so; a scheduled post shows
 * its time. And the composer's schedule window: 5 minutes to a year ahead.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import PostCard from '../PostCard';
import { scheduleProblem, scheduledIso, scheduleStateFrom, toLocalInput } from '../management/PostSchedulePicker';
import { editPostHref } from '../PostManageMenu';

jest.mock('../PostEngagement', () => ({ __esModule: true, default: () => null }));
jest.mock('../CommentsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
const deleteCommunityPost = jest.fn();
jest.mock('@/lib/api/community-posts', () => ({ deleteCommunityPost: (...args: unknown[]) => deleteCommunityPost(...args) }));

const post = {
  id: 'p1', channelId: 'c1', userId: 'u1', type: 'text', content: 'Hello', createdAt: new Date(Date.now() - 3600_000).toISOString(),
  likes: 0, comments: 0, shares: 0, views: 0, pinned: false, status: 'published', visibility: 'public', commentsEnabled: true, channelName: 'Noor', channelVerified: false,
} as unknown as CommunityPost;

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Post actions' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

describe('post card owner menu', () => {
  beforeEach(() => deleteCommunityPost.mockReset());

  it('has no actions button for visitors', () => {
    render(<PostCard post={post} />);
    expect(screen.queryByRole('button', { name: 'Post actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });

  it('gives the owner Edit (the editor) and Delete (asks first, then removes)', async () => {
    const onDeleted = jest.fn();
    deleteCommunityPost.mockResolvedValue({ success: true });
    render(<PostCard post={post} canManage onDeleted={onDeleted} />);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute('href', '/en/settings/channel/c1/community/p1/edit');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete this post?');
    expect(deleteCommunityPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('post-delete-confirm'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('p1'));
    expect(deleteCommunityPost).toHaveBeenCalledWith('c1', 'p1', { channelId: 'c1' });
  });

  it('a refused delete keeps the post and says so', async () => {
    const onDeleted = jest.fn();
    deleteCommunityPost.mockResolvedValue(null);
    render(<PostCard post={post} canManage onDeleted={onDeleted} />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByTestId('post-delete-confirm'));
    expect(await screen.findByTestId('post-delete-error')).toHaveTextContent('The post could not be deleted');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('shows a scheduled post its time', () => {
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    render(<PostCard post={{ ...post, status: 'scheduled', scheduledAt: at } as unknown as CommunityPost} canManage />);
    expect(screen.getByTestId('post-scheduled-label')).toHaveTextContent(/^Scheduled for /);
  });

  it('builds the editor address per language', () => {
    expect(editPostHref('ar', { id: 'p 1', channelId: 'c1' })).toBe('/ar/settings/channel/c1/community/p%201/edit');
  });
});

describe('schedule window', () => {
  const now = new Date('2026-11-14T10:00:00').getTime();
  it('takes 5 minutes to a year ahead', () => {
    expect(scheduleProblem('', now)).toBe('required');
    expect(scheduleProblem('2026-11-14T10:04', now)).toBe('too_soon');
    expect(scheduleProblem('2026-11-14T10:06', now)).toBeNull();
    expect(scheduleProblem('2027-11-15T10:00', now)).toBe('too_far');
  });

  it('round-trips a stored time and sends nothing for "now"', () => {
    const iso = new Date('2026-12-01T18:30:00').toISOString();
    const state = scheduleStateFrom(iso);
    expect(state).toEqual({ later: true, local: toLocalInput(new Date(iso)) });
    expect(scheduledIso(state)).toBe(iso);
    expect(scheduledIso({ later: false, local: state.local })).toBeNull();
    expect(scheduleStateFrom(null)).toEqual({ later: false, local: '' });
  });
});
