import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CREATOR_ERROR_CODES,
  CURRENT_CREATOR_TERMS_VERSION,
  EN_TRANSLATIONS as mockEn,
  AR_TRANSLATIONS as mockAr,
} from '@al-ummah/shared-types';
import { CreatorTermsDialog, CreatorTermsGate } from '../CreatorTermsGate';

const mockAccept = jest.fn();
let mockLiveTermsVersion: string = CURRENT_CREATOR_TERMS_VERSION;

jest.mock('@/hooks/useCreatorAccess', () => ({
  acceptCreatorTerms: (version?: string) => mockAccept(version),
  useCreatorAccess: () => ({
    status: 'ready',
    access: { canUpload: true, canCreateChannel: true, termsAccepted: false, termsVersion: mockLiveTermsVersion },
  }),
}));

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    lang: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
    t: mockLang === 'ar' ? mockAr : mockEn,
  }),
}));

describe('CreatorTermsGate', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockLiveTermsVersion = CURRENT_CREATOR_TERMS_VERSION;
    mockAccept.mockReset();
  });

  it('keeps agree disabled until checkbox is checked, links Terms and Community Guidelines, and sends shown version', async () => {
    mockAccept.mockResolvedValue({ ok: true });
    const onAccepted = jest.fn();
    render(<CreatorTermsGate onAccepted={onAccepted} />);

    expect(screen.getByTestId('creator-terms-link')).toHaveAttribute('href', 'https://www.alummahnow.net/en/terms/');
    expect(screen.getByTestId('creator-guidelines-link')).toHaveAttribute('href', '/en/community-guidelines');

    const agreeBtn = screen.getByTestId('creator-terms-agree');
    expect(agreeBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('creator-terms-checkbox'));
    expect(agreeBtn).toBeEnabled();

    fireEvent.click(agreeBtn);
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(mockAccept).toHaveBeenCalledWith(CURRENT_CREATOR_TERMS_VERSION);
  });

  it('unchecks and shows version-changed message when server answers 409 terms_version_changed', async () => {
    mockAccept.mockResolvedValue({ ok: false, code: CREATOR_ERROR_CODES.termsVersionChanged });
    render(<CreatorTermsGate termsVersion="2025-01-01" />);

    const checkbox = screen.getByTestId('creator-terms-checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByTestId('creator-terms-agree'));
    await waitFor(() => expect(screen.getByTestId('creator-terms-error')).toHaveTextContent(mockEn.upload.termsGateVersionChanged));
    expect(checkbox.checked).toBe(false);
    expect(mockAccept).toHaveBeenCalledWith('2025-01-01');
  });

  it('renders Arabic RTL links and shows error when saving fails', async () => {
    mockLang = 'ar';
    mockAccept.mockResolvedValue({ ok: false });
    render(<CreatorTermsGate compact />);

    expect(screen.getByTestId('creator-terms-gate')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('creator-terms-link')).toHaveAttribute('href', 'https://www.alummahnow.net/ar/terms/');
    expect(screen.getByTestId('creator-guidelines-link')).toHaveAttribute('href', '/ar/community-guidelines');

    fireEvent.click(screen.getByTestId('creator-terms-checkbox'));
    fireEvent.click(screen.getByTestId('creator-terms-agree'));
    await waitFor(() => expect(screen.getByTestId('creator-terms-error')).toBeInTheDocument());
  });

  it('unticks and shows version-changed notice when live version changes while gate is mounted', async () => {
    mockLiveTermsVersion = '2026-11-24';
    const { rerender } = render(<CreatorTermsGate />);
    const checkbox = screen.getByTestId('creator-terms-checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Simulate a background focus refresh delivering a newer version while the box was checked
    mockLiveTermsVersion = '2026-12-01';
    rerender(<CreatorTermsGate />);

    await waitFor(() => expect(screen.getByTestId('creator-terms-error')).toHaveTextContent(mockEn.upload.termsGateVersionChanged));
    expect(checkbox.checked).toBe(false);

    // Re-checking and agreeing sends the updated version
    mockAccept.mockResolvedValue({ ok: true });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId('creator-terms-agree'));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('2026-12-01'));
  });

  it('autoFocus moves focus to the Terms link for keyboard users in inline menus', () => {
    render(<CreatorTermsGate compact autoFocus />);
    expect(screen.getByTestId('creator-terms-link')).toHaveFocus();
  });

  it('CreatorTermsDialog exposes an accessible named dialog with Cancel and Escape support', () => {
    const onOpenChange = jest.fn();
    render(<CreatorTermsDialog open onOpenChange={onOpenChange} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName(mockEn.upload.termsGateTitle);

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.click(screen.getByTestId('creator-terms-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
