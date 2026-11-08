/**
 * Story 1.3 AC 2-5: privacy settings page (LTR + RTL).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
  }),
}));
const mockErase = jest.fn();
jest.mock('@/services/api/privacy.service', () => ({
  PrivacyService: { exportData: jest.fn(), eraseData: (...a: unknown[]) => mockErase(...a) },
  downloadBlob: jest.fn(),
}));
jest.mock('@/lib/runtime-config', () => ({ getAuthProfileUrl: () => 'https://profile.auth.qa.alummahnow.net', getApiUrl: () => '' }));

import { PrivacySettings } from '..';

describe('PrivacySettings', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockErase.mockReset();
  });

  it('signed out: consent and device data only', () => {
    render(<PrivacySettings signedIn={false} />);
    expect(screen.getByText(EN_TRANSLATIONS.privacy.consentSectionTitle)).toBeInTheDocument();
    expect(screen.getByText(EN_TRANSLATIONS.privacy.signInRequired)).toBeInTheDocument();
    expect(screen.queryByText(EN_TRANSLATIONS.privacy.exportButton)).toBeNull();
  });

  it('signed in: delete requires typing the confirmation word, then links to the account service', async () => {
    mockErase.mockResolvedValue({ complete: true, deleted: {}, anonymized: {} });
    render(<PrivacySettings signedIn />);
    const button = screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.deleteButton });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(EN_TRANSLATIONS.privacy.deleteDone)).toBeInTheDocument());
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: EN_TRANSLATIONS.privacy.manageAccount })).toHaveAttribute(
      'href',
      'https://profile.auth.qa.alummahnow.net',
    );
  });

  it('renders the Arabic RTL variant with the Arabic confirmation word', () => {
    mockLang = 'ar';
    const { container } = render(<PrivacySettings signedIn />);
    expect(container.firstChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(AR_TRANSLATIONS.privacy.settingsTitle)).toBeInTheDocument();
    expect(screen.getByText(AR_TRANSLATIONS.privacy.deleteConfirmLabel.replace('{word}', AR_TRANSLATIONS.privacy.deleteConfirmWord))).toBeInTheDocument();
  });
});
