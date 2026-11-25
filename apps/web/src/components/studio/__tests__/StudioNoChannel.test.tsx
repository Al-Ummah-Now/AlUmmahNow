/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@al-ummah/shared-types';
import { StudioNoChannel } from '../StudioNoChannel';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/help/HelpLink', () => ({ HelpLink: () => null }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en', dir: 'ltr' }),
}));

const mockCreateChannel = jest.fn();
const mockReloadChannels = jest.fn();
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({
    createChannel: mockCreateChannel,
    creatingChannel: false,
    reloadChannels: mockReloadChannels,
  }),
}));

let mockCreatorState: { status: string; access?: { termsAccepted?: boolean; termsVersion?: string } } = { status: 'unknown' };
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => mockCreatorState,
  needsCreatorTerms: (s: { status: string; access?: { termsAccepted?: boolean } }) =>
    s.status === 'ready' && s.access?.termsAccepted === false,
  acceptCreatorTerms: jest.fn().mockResolvedValue({ ok: true }),
}));

describe('StudioNoChannel creator terms handling', () => {
  beforeEach(() => {
    mockCreateChannel.mockReset();
    mockReloadChannels.mockReset();
    mockPush.mockReset();
    mockCreatorState = { status: 'unknown' };
  });

  it('opens CreatorTermsDialog on 403 terms_required even when creator access is unknown', async () => {
    mockCreateChannel.mockImplementation(async (_data: unknown, opts?: { onTermsRequired?: () => void }) => {
      opts?.onTermsRequired?.();
      return null;
    });

    render(<StudioNoChannel locale="en" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My New Channel' } });
    fireEvent.click(screen.getByTestId('studio-create-channel'));

    await waitFor(() => expect(screen.getByTestId('creator-terms-modal')).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
