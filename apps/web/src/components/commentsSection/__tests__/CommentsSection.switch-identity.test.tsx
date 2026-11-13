/**
 * "Commenting as {name} · Switch" (owner decision D5, docs/features/HELP-AND-TOUR.md): with
 * channels to choose from, Switch opens the account menu on its channel list; with none, there is
 * nothing to switch to and no button.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommentsSection from '..';
import { ACCOUNT_MENU_EVENT, type AccountMenuRequest } from '@/lib/navigation/account-menu-events';

let account: Record<string, unknown> = { user: null };

jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'viewer', displayName: 'Amina', avatarUrl: '/amina.png' } }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    isRTL: false,
    dir: 'ltr',
  }),
}));
jest.mock('@/hooks/useRealTimeComments', () => ({
  useRealTimeComments: () => ({
    comments: [], replies: {}, sort: 'newest', setSort: jest.fn(), commentSettings: 'on',
    addComment: jest.fn(), addReply: jest.fn(), updateComment: jest.fn(), deleteComment: jest.fn(),
    approveComment: jest.fn(), toggleLike: jest.fn(), toggleReplies: jest.fn(), loadMoreReplies: jest.fn(),
    loadMore: jest.fn(), hasMore: false, isLoading: false, isLoadingMore: false, loadError: false,
    isConnected: false, commentsCount: 0,
  }),
}));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const viewer = { id: 'viewer', email: 'viewer@test.local' } as never;

describe('Commenting as … · Switch', () => {
  it('opens the account menu on the channel list for a member with channels', () => {
    account = { id: 'viewer', channel: null, channels: [{ id: 'ch1', name: 'My channel' }] };
    const requests: AccountMenuRequest[] = [];
    const listener = (e: Event) => requests.push((e as CustomEvent<AccountMenuRequest>).detail);
    window.addEventListener(ACCOUNT_MENU_EVENT, listener);
    render(<CommentsSection videoId="v1" user={viewer} />);

    const line = screen.getByTestId('comment-identity');
    expect(line).toHaveTextContent('Commenting as Amina · Switch');
    // The visible word is part of the accessible name (WCAG 2.5.3)
    fireEvent.click(screen.getByRole('button', { name: 'Switch channel' }));
    expect(requests).toEqual([{ open: true, view: 'channels', focus: true }]);
    window.removeEventListener(ACCOUNT_MENU_EVENT, listener);
  });

  it('names the channel in the page language, isolated so mixed scripts keep their order', () => {
    account = { id: 'viewer', channel: { id: 'ch1', name: 'Community Corner', nameLocalized: { en: 'The Corner', ar: 'ركن المجتمع' } }, channels: [{ id: 'ch1', name: 'Community Corner' }] };
    render(<CommentsSection videoId="v1" user={viewer} />);
    const line = screen.getByTestId('comment-identity');
    expect(line).toHaveTextContent('Commenting as The Corner');
    expect(line.querySelector('bdi')).toHaveTextContent('The Corner');
  });

  it('has no Switch for a member without channels', () => {
    account = { id: 'viewer', channel: null, channels: [] };
    render(<CommentsSection videoId="v1" user={viewer} />);
    expect(screen.getByTestId('comment-identity')).toHaveTextContent('Commenting as Amina');
    expect(screen.queryByTestId('comment-identity-switch')).toBeNull();
  });
});
