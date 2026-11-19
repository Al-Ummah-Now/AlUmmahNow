/**
 * Story 29.4 on the post card: only the owner gets Edit and Delete (no dead menu for anyone else),
 * Delete removes the post at once (no confirm: a 30-day soft delete) and Undo brings it back, a
 * failure says so; a scheduled post shows
 * its time. And the composer's schedule window: 5 minutes to a year ahead.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import PostCard from '../PostCard';
import { PostSchedulePicker, joinLocal, scheduleProblem, scheduledIso, scheduleStateFrom, toLocalInput } from '../management/PostSchedulePicker';
import { editPostHref } from '../PostManageMenu';
import UndoToastHost from '@/components/common/UndoToastHost';

import { dismissUndoToast } from '@/lib/undo-toast';

jest.mock('../PostEngagement', () => ({ __esModule: true, default: () => null }));
jest.mock('../CommentsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
const deleteCommunityPost = jest.fn();
const restoreCommunityPost = jest.fn();
jest.mock('@/lib/api/community-posts', () => ({
  deleteCommunityPost: (...args: unknown[]) => deleteCommunityPost(...args),
  restoreCommunityPost: (...args: unknown[]) => restoreCommunityPost(...args),
}));

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
  beforeEach(() => {
    deleteCommunityPost.mockReset();
    restoreCommunityPost.mockReset();
    act(() => dismissUndoToast());
  });
  const withToast = (ui: React.ReactElement) => render(<>{ui}<UndoToastHost /></>);

  it('has no actions button for visitors', () => {
    render(<PostCard post={post} />);
    expect(screen.queryByRole('button', { name: 'Post actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });

  it('gives the owner Edit (the editor) and Delete (at once, no confirm), and Undo brings the post back', async () => {
    const onDeleted = jest.fn();
    const onRestored = jest.fn();
    deleteCommunityPost.mockResolvedValue({ success: true });
    restoreCommunityPost.mockResolvedValue({ success: true });
    withToast(<PostCard post={post} canManage onDeleted={onDeleted} onRestored={onRestored} />);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute('href', '/en/settings/channel/c1/community/p1/edit');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('p1'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteCommunityPost).toHaveBeenCalledWith('c1', 'p1', { channelId: 'c1' });
    const toast = await screen.findByTestId('post-delete-toast');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveTextContent('Post deleted');
    fireEvent.click(screen.getByTestId('post-delete-toast-undo'));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('p1'));
    expect(restoreCommunityPost).toHaveBeenCalledWith('c1', 'p1', { channelId: 'c1' });
    await waitFor(() => expect(screen.queryByTestId('post-delete-toast')).toBeNull());
  });

  it('a failed Undo keeps the toast and says so', async () => {
    const onRestored = jest.fn();
    deleteCommunityPost.mockResolvedValue({ success: true });
    restoreCommunityPost.mockResolvedValue(null);
    withToast(<PostCard post={post} canManage onDeleted={jest.fn()} onRestored={onRestored} />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByTestId('post-delete-toast-undo'));
    await waitFor(() => expect(screen.getByTestId('post-delete-toast')).toHaveTextContent('The post could not be restored'));
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.getByTestId('post-delete-toast-undo')).toBeEnabled();
  });

  it('a refused delete keeps the post and says so, with no Undo', async () => {
    const onDeleted = jest.fn();
    deleteCommunityPost.mockResolvedValue(null);
    withToast(<PostCard post={post} canManage onDeleted={onDeleted} />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByTestId('post-delete-toast')).toHaveTextContent('The post could not be deleted');
    expect(screen.queryByTestId('post-delete-toast-undo')).toBeNull();
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

  it('builds the time from separate date and time fields; half of it is not a time', () => {
    expect(joinLocal('2026-11-14', '10:06')).toBe('2026-11-14T10:06');
    expect(joinLocal('', '')).toBe('');
    expect(scheduleProblem(joinLocal('2026-11-14', ''), now)).toBe('required');
    expect(scheduleProblem(joinLocal('', '10:06'), now)).toBe('required');
  });

  it('the picker edits the date and the time each on its own field', () => {
    const onChange = jest.fn();
    render(<PostSchedulePicker value={{ later: true, local: '2026-11-20T09:15' }} onChange={onChange} timeOnly />);
    expect(screen.getByTestId('post-schedule-date')).toHaveValue('2026-11-20');
    expect(screen.getByTestId('post-schedule-time')).toHaveValue('09:15');
    fireEvent.change(screen.getByTestId('post-schedule-time'), { target: { value: '18:45' } });
    expect(onChange).toHaveBeenLastCalledWith({ later: true, local: '2026-11-20T18:45' });
    fireEvent.change(screen.getByTestId('post-schedule-date'), { target: { value: '2026-11-21' } });
    expect(onChange).toHaveBeenLastCalledWith({ later: true, local: '2026-11-21T09:15' });
  });
});
