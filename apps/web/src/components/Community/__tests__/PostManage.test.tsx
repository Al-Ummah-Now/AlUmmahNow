/**
 * The post card's ⋮ menu (#1515, Story 29.4): everyone gets Copy link, a signed-in viewer also
 * Report, and the post's channel Edit and Delete. Delete removes the post at once (no confirm: a
 * 30-day soft delete) and Undo brings it back; a failure says so. A scheduled post shows its time.
 * And the composer's schedule window, date, time and zone.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommunityPost } from '@al-ummah/shared-types';
import PostCard from '../PostCard';
import { PostSchedulePicker, formatSlot, joinLocal, scheduleProblem, scheduledIso, scheduleStateFrom, timeSlots, toLocalInput } from '../management/PostSchedulePicker';
import { formatPickedDate } from '@/components/ui/LocalizedDatePicker';
import { offsetLabel, wallTimeToDate, zoneLabel } from '@/lib/time/zones';
import { editPostHref } from '../PostActionsMenu';
import UndoToastHost from '@/components/common/UndoToastHost';

import { dismissUndoToast } from '@/lib/undo-toast';

jest.mock('../PostEngagement', () => ({ __esModule: true, default: () => null }));
jest.mock('../CommentsSection', () => ({ __esModule: true, default: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/en/channels/c1' }));
let viewer: { id: string } | null = null;
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: viewer }), useAuth: () => ({ user: viewer }) }));
jest.mock('@/components/moderation/ReportContentButton', () => ({
  __esModule: true,
  default: ({ open, contentType, contentId }: { open?: boolean; contentType: string; contentId: string }) =>
    open ? <div role="dialog" data-testid="report-dialog">{`${contentType}:${contentId}`}</div> : null,
}));
const copyText = jest.fn(async () => true);
jest.mock('@/lib/share/copy', () => ({ copyText: (...args: unknown[]) => copyText(...(args as [])) }));
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
    push.mockReset();
    copyText.mockClear();
    viewer = null;
    act(() => dismissUndoToast());
  });
  const withToast = (ui: React.ReactElement) => render(<>{ui}<UndoToastHost /></>);

  const names = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

  it('gives a signed-out visitor Copy link only, which copies the post link', async () => {
    withToast(<PostCard post={post} />);
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    await openMenu();
    expect(names()).toEqual(['Copy link']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringMatching(/\/en\/post\/p1$/)));
    expect(await screen.findByTestId('post-link-toast')).toHaveTextContent('Link copied');
  });

  it('gives a signed-in viewer Copy link and Report, which opens the shared report dialog for the post', async () => {
    viewer = { id: 'someone' };
    render(<PostCard post={post} />);
    await openMenu();
    expect(names()).toEqual(['Copy link', 'Report']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }));
    expect(await screen.findByTestId('report-dialog')).toHaveTextContent('post:p1');
  });

  it('never offers Report on the viewer\'s own post', async () => {
    viewer = { id: 'u1' };
    render(<PostCard post={post} />);
    await openMenu();
    expect(names()).toEqual(['Copy link']);
  });

  it('the post\'s channel gets Edit and a danger Delete; Edit opens the editor', async () => {
    viewer = { id: 'u1' };
    render(<PostCard post={post} canManage />);
    await openMenu();
    expect(names()).toEqual(['Copy link', 'Edit', 'Delete']);
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-danger');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(push).toHaveBeenCalledWith('/en/studio/c1/content/posts/p1/edit');
  });

  it('gives the owner Edit (the editor) and Delete (at once, no confirm), and Undo brings the post back', async () => {
    const onDeleted = jest.fn();
    const onRestored = jest.fn();
    deleteCommunityPost.mockResolvedValue({ success: true });
    restoreCommunityPost.mockResolvedValue({ success: true });
    withToast(<PostCard post={post} canManage onDeleted={onDeleted} onRestored={onRestored} />);
    await openMenu();
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
    expect(editPostHref('ar', { id: 'p 1', channelId: 'c1' })).toBe('/ar/studio/c1/content/posts/p%201/edit');
  });
});

describe('schedule window', () => {
  const now = new Date('2026-11-14T15:00:00Z').getTime();
  const NY = 'America/New_York';
  it('takes 5 minutes to a year ahead, on the chosen zone\'s clock', () => {
    expect(scheduleProblem('', now, NY)).toBe('required');
    expect(scheduleProblem('2026-11-14T10:04', now, NY)).toBe('too_soon');
    expect(scheduleProblem('2026-11-14T10:06', now, NY)).toBeNull();
    // The same wall time in London is 5 hours earlier: already past
    expect(scheduleProblem('2026-11-14T10:06', now, 'Europe/London')).toBe('too_soon');
    expect(scheduleProblem('2027-11-15T10:00', now, NY)).toBe('too_far');
  });

  it('round-trips a stored time in a zone and sends nothing for "now"', () => {
    const iso = '2026-12-01T23:30:00.000Z';
    const state = scheduleStateFrom(iso, NY);
    expect(state).toEqual({ later: true, local: '2026-12-01T18:30', zone: NY });
    expect(scheduledIso(state)).toBe(iso);
    expect(scheduledIso({ ...state, zone: 'Asia/Riyadh' })).toBe('2026-12-01T15:30:00.000Z');
    expect(scheduledIso({ ...state, later: false })).toBeNull();
    expect(scheduleStateFrom(null, NY)).toEqual({ later: false, local: '', zone: NY });
    expect(toLocalInput(new Date(iso), NY)).toBe('2026-12-01T18:30');
  });

  it('crosses a daylight-saving change on the right side', () => {
    expect(wallTimeToDate('2026-03-08T03:30', NY).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(wallTimeToDate('2026-11-01T12:00', NY).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });

  it('builds the time from separate date and time parts; half of it is not a time', () => {
    expect(joinLocal('2026-11-14', '10:06')).toBe('2026-11-14T10:06');
    expect(joinLocal('', '')).toBe('');
    expect(scheduleProblem(joinLocal('2026-11-14', ''), now, NY)).toBe('required');
    expect(scheduleProblem(joinLocal('', '10:06'), now, NY)).toBe('required');
  });
});

describe('localized date, time and zone', () => {
  it('reads dates and times in Arabic digits and English digits', () => {
    expect(formatPickedDate('2026-11-16', 'ar')).toMatch(/١٦/);
    expect(formatPickedDate('2026-11-16', 'ar')).not.toMatch(/[0-9]/);
    expect(formatPickedDate('2026-11-16', 'en')).toMatch(/Nov 16, 2026/);
    expect(formatSlot('19:30', 'ar')).toMatch(/^٧:٣٠/);
    expect(formatSlot('19:30', 'en')).toBe('7:30 PM');
  });

  it('lists the day in 15-minute steps and keeps an off-step time', () => {
    expect(timeSlots('')).toHaveLength(96);
    expect(timeSlots('')[1]).toBe('00:15');
    expect(timeSlots('09:07')).toContain('09:07');
  });

  it('names a zone in the page language with its offset, never the raw id', () => {
    const winter = new Date('2026-11-16T12:00:00Z');
    expect(zoneLabel('America/New_York', 'en', winter)).toBe('Eastern Time\u00a0(GMT−5)');
    const ar = zoneLabel('America/New_York', 'ar', winter);
    // The offset is a left-to-right isolate, so it never reads «(٥−GMT)»
    expect(ar).toContain('(\u2066GMT−٥\u2069)');
    expect(ar).not.toContain('America/New_York');
    // The same name as English: «التوقيت الشرقي», without CLDR's «لأمريكا الشمالية» that "Eastern Time" doesn't say
    expect(ar).toBe('التوقيت الشرقي\u00a0(\u2066GMT−٥\u2069)');
    expect(zoneLabel('America/Chicago', 'ar', winter)).toBe('التوقيت المركزي\u00a0(\u2066GMT−٦\u2069)');
    expect(offsetLabel('Asia/Kolkata', 'ar', winter)).toBe('GMT+٥:٣٠');
    expect(offsetLabel('UTC', 'en', winter)).toBe('GMT');
  });

  // The calendar's bounds come from now: pin it so the days used here stay in range
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-14T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('the picker shows the date on a button and the zone by name, and edits each part on its own', () => {
    const onChange = jest.fn();
    render(<PostSchedulePicker value={{ later: true, local: '2026-11-20T09:15', zone: 'America/New_York' }} onChange={onChange} timeOnly />);
    expect(screen.getByTestId('post-schedule-date-button')).toHaveTextContent('Nov 20, 2026');
    expect(screen.queryByDisplayValue('2026-11-20')).toBeNull();
    expect(screen.getByTestId('post-schedule-timezone')).toHaveTextContent(/^Eastern Time \(GMT−5\)$/);
    expect(screen.getByTestId('post-schedule-time')).toHaveTextContent('9:15 AM');
    fireEvent.click(screen.getByTestId('post-schedule-date-button'));
    const calendar = screen.getByTestId('post-schedule-date-calendar');
    expect(calendar).toHaveAttribute('role', 'dialog');
    fireEvent.click(screen.getByRole('button', { name: /November 21, 2026/ }));
    expect(onChange).toHaveBeenLastCalledWith({ later: true, local: '2026-11-21T09:15', zone: 'America/New_York' });
  });

  it('Escape closes the calendar while focus is still on the date button', () => {
    render(<PostSchedulePicker value={{ later: true, local: '2026-11-20T09:15', zone: 'America/New_York' }} onChange={jest.fn()} timeOnly />);
    const button = screen.getByTestId('post-schedule-date-button');
    fireEvent.click(button);
    expect(screen.getByTestId('post-schedule-date-calendar')).toBeInTheDocument();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByTestId('post-schedule-date-calendar')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('the calendar moves by keyboard and never picks a day out of range', () => {
    const onChange = jest.fn();
    render(<PostSchedulePicker value={{ later: true, local: '2026-11-20T09:15', zone: 'America/New_York' }} onChange={onChange} timeOnly />);
    fireEvent.click(screen.getByTestId('post-schedule-date-button'));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAccessibleName(/November 28, 2026/);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ local: '2026-11-28T09:15' }));
    // Before today (14 Nov) is out of range: shown, but not pickable
    fireEvent.click(screen.getByTestId('post-schedule-date-button'));
    const past = screen.getByRole('button', { name: /November 13, 2026/ });
    expect(past).toBeDisabled();
    expect(screen.getByRole('button', { name: /November 14, 2026/ })).toBeEnabled();
  });
});
