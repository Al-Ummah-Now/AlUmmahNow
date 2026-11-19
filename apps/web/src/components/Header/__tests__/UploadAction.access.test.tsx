/**
 * Upload is by invitation (creator tiers, #1627): the header and tab bar Upload show only for a
 * signed-in account whose tier allows uploads. Signed out, while the tier is being read or when it
 * could not be read there is no Upload at all: never a teaser or a sign-in detour. (Without a tier
 * the Request tier pill takes its place: UploadAction.test.tsx.)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { UploadAction } from '../UploadAction';
import { showsUpload, type CreatorAccessState } from '@/hooks/useCreatorAccess';

const EN = jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
const AR = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS;
let lang: 'en' | 'ar' = 'en';
let user: Record<string, unknown> | null = null;
let account: Record<string, unknown> | null = null;
let creator: CreatorAccessState = { status: 'signed-out' };

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: lang === 'ar' ? AR : EN, lang, isRTL: lang === 'ar' }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: account }) }));
jest.mock('@/hooks/useCreatorAccess', () => {
  const actual = jest.requireActual('@/hooks/useCreatorAccess');
  return { ...actual, useCreatorAccess: () => creator };
});
jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const access = (canUpload: boolean): CreatorAccessState => ({
  status: 'ready',
  access: {
    tier: canUpload ? { id: 'creator', name: 'Creator', unlimited: false } : null,
    via: canUpload ? 'tier' : 'none',
    canUpload,
    canCreateChannel: canUpload,
    channelsOwned: canUpload ? 1 : 0,
    maxChannels: canUpload ? 3 : null,
    limits: null,
    usage: { hour: 0, day: 0 },
  } as never,
});

const both = () => {
  render(<><UploadAction /><UploadAction variant="tab" /></>);
};

beforeEach(() => {
  lang = 'en';
  user = null;
  account = null;
  creator = { status: 'signed-out' };
});

describe('UploadAction', () => {
  it.each(['en', 'ar'] as const)('shows nothing to a signed-out visitor, header or tab bar (%s)', (l) => {
    lang = l;
    both();
    expect(screen.queryByTestId('header-upload')).toBeNull();
    expect(screen.queryByTestId('tab-upload')).toBeNull();
    expect(document.querySelector('a[href*="/upload"]')).toBeNull();
  });

  it('shows nothing signed out even if a stale creator answer is cached', () => {
    creator = access(true);
    both();
    expect(screen.queryByTestId('header-upload')).toBeNull();
    expect(screen.queryByTestId('tab-upload')).toBeNull();
  });

  it('shows nothing to a signed-in member whose tier does not allow uploads', () => {
    user = { id: 'u1' };
    account = { userId: 'u1', channel: { id: 'c1' } };
    creator = access(false);
    both();
    expect(screen.queryByTestId('header-upload')).toBeNull();
    expect(screen.queryByTestId('tab-upload')).toBeNull();
  });

  it.each([{ status: 'loading' }, { status: 'unknown' }] as CreatorAccessState[])('shows nothing while the tier is $status', (state) => {
    user = { id: 'u1' };
    account = { userId: 'u1', channel: { id: 'c1' } };
    creator = state;
    both();
    expect(screen.queryByTestId('header-upload')).toBeNull();
    expect(screen.queryByTestId('tab-upload')).toBeNull();
  });

  it.each(['en', 'ar'] as const)('links a creator to the upload form for the active channel (%s)', (l) => {
    lang = l;
    user = { id: 'u1' };
    account = { userId: 'u1', channel: { id: 'c 1' } };
    creator = access(true);
    both();
    for (const id of ['header-upload', 'tab-upload']) {
      const link = screen.getByTestId(id);
      expect(link).toHaveAttribute('href', `/${l}/upload?channel=c%201`);
      expect(link).toHaveAttribute('data-state', 'ready');
      expect(link).toHaveAccessibleName((l === 'ar' ? AR : EN).upload.uploadVideo);
    }
  });

  it('acting as yourself, a creator who may create a channel gets the upload page (it offers Create a channel)', () => {
    user = { id: 'u1' };
    account = { userId: 'u1', channel: null };
    creator = access(true);
    both();
    for (const id of ['header-upload', 'tab-upload']) expect(screen.getByTestId(id)).toHaveAttribute('href', '/en/upload');
  });

  it('acting as yourself, someone who may not create a channel sees no Upload (never a greyed-out control)', () => {
    user = { id: 'u1' };
    account = { userId: 'u1', channel: null };
    creator = { status: 'ready', access: { ...(access(true) as { access: object }).access, canCreateChannel: false } } as CreatorAccessState;
    both();
    expect(screen.queryByTestId('header-upload')).toBeNull();
    expect(screen.queryByTestId('tab-upload')).toBeNull();
  });
});

describe('showsUpload', () => {
  it('is true only when the server said the tier allows uploads', () => {
    expect(showsUpload({ status: 'signed-out' })).toBe(false);
    expect(showsUpload({ status: 'loading' })).toBe(false);
    expect(showsUpload({ status: 'unknown' })).toBe(false);
    expect(showsUpload(access(false))).toBe(false);
    expect(showsUpload(access(true))).toBe(true);
  });
});
