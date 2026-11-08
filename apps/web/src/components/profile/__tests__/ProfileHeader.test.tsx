/**
 * ProfileHeader (view and in-place editing), the account settings header,
 * and the profile editor's draft model.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { ProfileHeader, type ProfileHeaderEditing } from '../ProfileHeader';
import { AccountSettingsHeader } from '@/components/settings/AccountSettingsHeader';
import { changedProfileFields, profileDraftFrom } from '@/app/[locale]/profile/edit/draft';
import type { Profile } from '@/interfaces';

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, ...props }: Record<string, unknown>) => <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, isRTL: false, lang: 'en', locale: 'en', dir: 'ltr' }),
}));
const mockUser = { current: null as null | { id?: string; email: string; displayName: string; avatarUrl?: string; channel: { id: string } | null } };
const mockProfile = { current: null as null | Partial<Profile> };
jest.mock('@/lib/api/profiles-client', () => ({
  fetchProfile: (_user: unknown, set: (p: unknown) => void) => {
    if (mockProfile.current) set(mockProfile.current);
    return Promise.resolve(!!mockProfile.current);
  },
}));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: mockUser.current }) }));
jest.mock('@/components/ImageCropDialog', () => ({
  __esModule: true,
  default: ({ file, onApply }: { file: File | null; onApply: (f: File) => void }) =>
    file ? <button onClick={() => onApply(new File(['c'], 'cropped.jpg'))}>Apply crop</button> : null,
}));

function editing(overrides: Partial<ProfileHeaderEditing> = {}): ProfileHeaderEditing {
  return {
    active: true,
    firstName: 'Maryam',
    lastName: 'Haddad',
    displayName: 'Maryam H.',
    bio: '',
    onChange: jest.fn(),
    onImage: jest.fn(),
    ...overrides,
  };
}

describe('ProfileHeader', () => {
  it('view mode: heading and the page action, nothing editable', () => {
    render(<ProfileHeader heading="Maryam Haddad" action={<button>Edit</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Maryam Haddad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change profile photo' })).not.toBeInTheDocument();
  });

  it('editing: names, display name, bio, cover and photo are editable in place', () => {
    render(<ProfileHeader heading="Maryam Haddad" coverUrl="https://cdn.example/c.jpg" editing={editing()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maryam');
    for (const name of ['Edit First name', 'Edit Last name', 'Edit Display name', 'Edit Bio', 'Change cover photo', 'Change profile photo']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Add a short bio')).toBeInTheDocument();
  });

  it('commits a changed last name', () => {
    const e = editing();
    render(<ProfileHeader heading="Maryam Haddad" editing={e} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Last name' }));
    fireEvent.change(screen.getByTestId('profile-last-name-input'), { target: { value: ' Al-Haddad ' } });
    fireEvent.keyDown(screen.getByTestId('profile-last-name-input'), { key: 'Enter' });
    expect(e.onChange).toHaveBeenCalledWith('lastName', 'Al-Haddad');
  });

  it('uploads a new profile photo after the crop', () => {
    const e = editing();
    render(<ProfileHeader heading="Maryam Haddad" editing={e} />);
    fireEvent.change(screen.getByTestId('profile-photo-input'), { target: { files: [new File(['x'], 'a.png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }));
    expect(e.onImage).toHaveBeenCalledWith('avatar', expect.any(File));
  });

  it('offers to add a cover when there is none, and keeps the photo square (#300)', () => {
    render(<ProfileHeader heading="Maryam" editing={editing()} />);
    expect(screen.getByRole('button', { name: 'Add a banner' })).toBeInTheDocument();
    expect(screen.getByTestId('profile-photo').className).toMatch(/aspect-square/);
  });
});

describe('AccountSettingsHeader', () => {
  it('renders nothing when signed out', () => {
    mockUser.current = null;
    const { container } = render(<AccountSettingsHeader current="privacy" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows who is signed in and the settings tabs, with the current one marked', () => {
    mockUser.current = { email: 'm@example.org', displayName: 'Maryam Haddad', channel: { id: 'ch1' } };
    render(<AccountSettingsHeader current="privacy" />);
    expect(screen.getByTestId('account-settings-name')).toHaveTextContent('Maryam Haddad');
    expect(screen.getByText('m@example.org')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Channel' })).toHaveAttribute('href', '/en/settings/channel/ch1');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/en/profile/edit');
  });

  it('names the user from their profile in the page language, like the navigation', async () => {
    mockUser.current = { id: 'u1', email: 'm@example.org', displayName: '', channel: null };
    mockProfile.current = { displayName: 'Maryam H.', displayNameLocalized: { en: 'Maryam Haddad' } };
    render(<AccountSettingsHeader current="account" />);
    await waitFor(() => expect(screen.getByTestId('account-settings-name')).toHaveTextContent('Maryam Haddad'));
    mockProfile.current = null;
  });

  it('on the profile page shows only the tabs (the profile header is the identity)', () => {
    mockUser.current = { id: 'u1', email: 'm@example.org', displayName: 'Maryam', channel: null };
    render(<AccountSettingsHeader current="profile" />);
    expect(screen.queryByTestId('account-settings-name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves out the channel tab without an active channel', () => {
    mockUser.current = { email: 'm@example.org', displayName: '', channel: null };
    render(<AccountSettingsHeader current="account" />);
    expect(screen.queryByRole('link', { name: 'Channel' })).not.toBeInTheDocument();
    expect(screen.getByTestId('account-settings-name')).toHaveTextContent('m@example.org');
  });
});

describe('Profile draft', () => {
  const profile = {
    id: 'u', email: 'm@example.org', firstName: 'Maryam', lastName: 'Haddad', firstNameLocalized: { ar: 'مريم' },
    displayName: 'Maryam H.', bio: '', timezone: '',
  } as unknown as Profile;

  it('builds localized drafts with the browser timezone as fallback', () => {
    expect(profileDraftFrom(profile, 'Asia/Amman')).toMatchObject({ firstNameEn: 'Maryam', firstNameAr: 'مريم', lastNameAr: '', timezone: 'Asia/Amman' });
  });

  it('reports changed fields, ignoring surrounding spaces', () => {
    const saved = profileDraftFrom(profile, 'UTC');
    expect(changedProfileFields(saved, { ...saved, firstNameEn: ' Maryam ' })).toEqual([]);
    expect(changedProfileFields(saved, { ...saved, bioAr: 'نبذة', timezone: 'Africa/Cairo' })).toEqual(['bioAr', 'timezone']);
  });
});
