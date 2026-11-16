import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CAPTIONS_EN } from '@al-ummah/shared-types';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
let mockFeatures: Record<string, boolean> = {};
const mockRefreshFeatures = jest.fn(async () => undefined);
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: mockFeatures }), refreshFeatures: (...a: unknown[]) => mockRefreshFeatures(...(a as [])) }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ref') }));
const api = {
  getChannelTranslationSettings: jest.fn(),
  setChannelTranslationSettings: jest.fn(),
  getChannelQuranEditions: jest.fn(),
  listQuranEditions: jest.fn(),
  setChannelQuranEdition: jest.fn(),
  resetChannelQuranEdition: jest.fn(),
};
jest.mock('@/lib/api/translate', () => ({
  getChannelTranslationSettings: (...a: unknown[]) => api.getChannelTranslationSettings(...a),
  setChannelTranslationSettings: (...a: unknown[]) => api.setChannelTranslationSettings(...a),
  getChannelQuranEditions: (...a: unknown[]) => api.getChannelQuranEditions(...a),
  listQuranEditions: (...a: unknown[]) => api.listQuranEditions(...a),
  setChannelQuranEdition: (...a: unknown[]) => api.setChannelQuranEdition(...a),
  resetChannelQuranEdition: (...a: unknown[]) => api.resetChannelQuranEdition(...a),
}));

import ChannelTranslationSettings from '../ChannelTranslationSettings';

const cs = CAPTIONS_EN.channelSettings;
const saheeh = { language: 'en', id: 20, name: 'Saheeh International', source: 'default' as const };

describe('ChannelTranslationSettings', () => {
  beforeEach(() => {
    mockFeatures = { viewerTranslatedTitles: true, quranEditions: true };
    Object.values(api).forEach((f) => f.mockReset());
    api.getChannelTranslationSettings.mockResolvedValue({ ok: true, data: { viewerTitles: true, platformEnabled: false } });
    api.getChannelQuranEditions.mockResolvedValue({ ok: true, data: { editions: [saheeh, { language: 'ar', id: 0, name: '', source: 'default' }] } });
    api.listQuranEditions.mockResolvedValue({ ok: true, data: { editions: [{ id: 20, name: 'Saheeh International', language: 'en' }, { id: 85, name: 'Abdel Haleem', language: 'en' }] } });
  });

  it('no card at all while neither part is on (no Quran credentials, viewer titles off for the site)', async () => {
    mockFeatures = {};
    const { container } = render(<ChannelTranslationSettings channelId="c1" />);
    await act(async () => {});
    expect(container.querySelector('[data-testid="channel-translation-settings"]')).toBeNull();
    expect(api.getChannelTranslationSettings).not.toHaveBeenCalled();
    expect(api.getChannelQuranEditions).not.toHaveBeenCalled();
  });

  it('only the part that is on: Quran without viewer titles, viewer titles without Quran', async () => {
    mockFeatures = { quranEditions: true };
    const { unmount } = render(<ChannelTranslationSettings channelId="c1" />);
    expect(await screen.findByTestId('channel-quran-en')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-viewer-titles')).toBeNull();
    unmount();
    mockFeatures = { viewerTranslatedTitles: true };
    render(<ChannelTranslationSettings channelId="c1" />);
    expect(await screen.findByTestId('channel-viewer-titles')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-quran-en')).toBeNull();
  });

  it("shows the edition per language (never Arabic), with no 'paused for the site' note", async () => {
    render(<ChannelTranslationSettings channelId="c1" />);
    await waitFor(() => expect(screen.getByTestId('channel-quran-en')).toBeInTheDocument());
    expect(screen.queryByTestId('channel-quran-ar')).toBeNull();
    expect(screen.getByTestId('channel-quran-en')).toHaveTextContent(cs.sourceDefault);
    expect(screen.queryByText(/paused/i)).toBeNull();
  });

  it("saves a picked edition and shows it as the channel's choice", async () => {
    api.setChannelQuranEdition.mockResolvedValue({ ok: true, data: { editions: [{ language: 'en', id: 85, name: 'Abdel Haleem', source: 'channel' }] } });
    render(<ChannelTranslationSettings channelId="c1" />);
    const select = await screen.findByTestId('channel-quran-en-select');
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('channel-quran-en-save'));
    });
    expect(api.setChannelQuranEdition).toHaveBeenCalledWith('c1', 'en', 85);
    expect(screen.getByTestId('channel-quran-en')).toHaveAttribute('data-source', 'channel');
    expect(screen.getByTestId('channel-quran-en-reset')).toBeInTheDocument();
  });

  it('says when Quran Foundation is unreachable instead of offering a picker', async () => {
    api.listQuranEditions.mockResolvedValue({ ok: false, status: 503, error: 'quran_unavailable' });
    render(<ChannelTranslationSettings channelId="c1" />);
    await waitFor(() => expect(screen.getByTestId('channel-quran-en')).toHaveTextContent(cs.unavailable));
    expect(screen.queryByTestId('channel-quran-en-select')).toBeNull();
  });

  it('turns machine-translated titles off for the channel', async () => {
    api.setChannelTranslationSettings.mockResolvedValue({ ok: true, data: { viewerTitles: false, platformEnabled: false } });
    render(<ChannelTranslationSettings channelId="c1" />);
    const box = await screen.findByTestId('channel-viewer-titles');
    expect(box).toBeChecked();
    await act(async () => {
      fireEvent.click(box);
    });
    expect(api.setChannelTranslationSettings).toHaveBeenCalledWith('c1', false);
    expect(box).not.toBeChecked();
  });
});
