/**
 * The header pill for a user whose tier allows no uploads follows the Upgrade
 * page's mode (owner, 2026-11-15): "Request tier" in request mode, "Upgrade"
 * in pay mode, nothing when upgrades are closed or the mode is unknown; en and ar.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { UploadAction } from '../UploadAction';

let mockLang: 'en' | 'ar' = 'en';
let mockMode: 'pay' | 'request' | 'closed' | undefined = 'request';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => <a {...(p as object)}>{children}</a> }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useMultiAccount: () => ({ user: { channel: null } }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { canUpload: false, canCreateChannel: false, tier: null, via: 'tier', uploadChannelIds: [], channelsOwned: 0, maxChannels: 0, limits: null, usage: { hour: 0, day: 0 }, upgradeMode: mockMode } }),
  mayUpload: () => false,
}));

describe('header pill for users who cannot upload', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  it('request mode: "Request tier" to /upgrade', () => {
    mockMode = 'request';
    render(<UploadAction />);
    const pill = screen.getByTestId('header-request-access');
    expect(pill).toHaveTextContent('Request tier');
    expect(pill).toHaveAttribute('href', '/en/upgrade');
  });

  it('mode unknown (it could not be read): no pill, never "Request tier"', () => {
    mockMode = undefined;
    const { container } = render(<UploadAction />);
    expect(screen.queryByTestId('header-request-access')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('pay mode: "Upgrade"; in Arabic «ترقية»', () => {
    mockMode = 'pay';
    const { unmount } = render(<UploadAction />);
    expect(screen.getByTestId('header-request-access')).toHaveTextContent(/^Upgrade$/);
    unmount();
    mockLang = 'ar';
    render(<UploadAction />);
    expect(screen.getByTestId('header-request-access')).toHaveTextContent('ترقية');
    expect(screen.getByTestId('header-request-access')).toHaveAttribute('href', '/ar/upgrade');
  });

  it('closed mode: no pill at all', () => {
    mockMode = 'closed';
    const { container } = render(<UploadAction />);
    expect(screen.queryByTestId('header-request-access')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('request mode in Arabic: «اطلب فئة»', () => {
    mockMode = 'request';
    mockLang = 'ar';
    render(<UploadAction />);
    expect(screen.getByTestId('header-request-access')).toHaveTextContent('اطلب فئة');
  });
});
