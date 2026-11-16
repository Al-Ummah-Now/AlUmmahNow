import { fireEvent, render, screen } from '@testing-library/react';
import { STUDIO_AR, STUDIO_EN } from '@al-ummah/shared-types';
import { InviteWelcome } from '../InviteWelcome';

const replace = jest.fn();
let search = '';
let mockStudio = STUDIO_EN;

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/studio/c1/dashboard',
  useRouter: () => ({ replace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));

beforeEach(() => {
  replace.mockClear();
  search = '';
  mockStudio = STUDIO_EN;
});

describe('InviteWelcome', () => {
  it('shows nothing without ?welcome=invite', () => {
    search = 'welcome=other';
    render(<InviteWelcome variant="studio" />);
    expect(screen.queryByTestId('invite-welcome')).toBeNull();
  });

  it('welcomes the invited creator in the Studio, as a labelled region', () => {
    search = 'welcome=invite';
    render(<InviteWelcome variant="studio" />);
    const region = screen.getByRole('region', { name: STUDIO_EN.dashboard.inviteWelcome.title });
    expect(region).toHaveTextContent(STUDIO_EN.dashboard.inviteWelcome.studio);
  });

  it('on the account page says the account is ready', () => {
    search = 'welcome=invite';
    render(<InviteWelcome variant="account" />);
    expect(screen.getByTestId('invite-welcome')).toHaveTextContent(STUDIO_EN.dashboard.inviteWelcome.account);
  });

  it('Dismiss drops only the welcome query, so it never shows again', () => {
    search = 'welcome=invite&tab=x';
    render(<InviteWelcome variant="studio" />);
    fireEvent.click(screen.getByRole('button', { name: STUDIO_EN.dashboard.inviteWelcome.dismiss }));
    expect(replace).toHaveBeenCalledWith('/en/studio/c1/dashboard?tab=x', { scroll: false });
  });

  it('speaks Arabic', () => {
    search = 'welcome=invite';
    mockStudio = STUDIO_AR;
    render(<InviteWelcome variant="studio" />);
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeInTheDocument();
    expect(screen.getByText('مرحبًا بك في الأمة الآن')).toBeInTheDocument();
  });
});
