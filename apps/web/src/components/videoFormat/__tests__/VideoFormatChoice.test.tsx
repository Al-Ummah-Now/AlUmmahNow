import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VideoFormatChoice, formatChoiceOf } from '../VideoFormatChoice';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const t = mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS;
    return { t, lang: mockLang, locale: mockLang, dir: mockLang === 'ar' ? 'rtl' : 'ltr', isRTL: mockLang === 'ar' };
  },
}));

describe('VideoFormatChoice (Upload as Short / as video)', () => {
  afterEach(() => {
    mockLang = 'en';
  });

  it('offers auto, Short and video, and reports the choice', () => {
    const onChange = jest.fn();
    render(<VideoFormatChoice value="auto" onChange={onChange} />);
    expect(screen.getByText('Upload as Short')).toBeInTheDocument();
    expect(screen.getByText('Upload as video')).toBeInTheDocument();
    expect(screen.getByTestId('video-format-auto')).toBeChecked();
    fireEvent.click(screen.getByTestId('video-format-short'));
    expect(onChange).toHaveBeenCalledWith('short');
    fireEvent.click(screen.getByTestId('video-format-video'));
    expect(onChange).toHaveBeenCalledWith('video');
  });

  it('shows Arabic labels', () => {
    mockLang = 'ar';
    render(<VideoFormatChoice value="short" onChange={jest.fn()} />);
    expect(screen.getByText('رفع كمقطع قصير')).toBeInTheDocument();
    expect(screen.getByText('رفع كفيديو')).toBeInTheDocument();
    expect(screen.getByTestId('video-format-short')).toBeChecked();
  });

  it('reads the stored override; anything else is auto', () => {
    expect(formatChoiceOf({ format: 'short' })).toBe('short');
    expect(formatChoiceOf({ format: 'video' })).toBe('video');
    expect(formatChoiceOf({ format: 'mp4' })).toBe('auto');
    expect(formatChoiceOf({})).toBe('auto');
    expect(formatChoiceOf(null)).toBe('auto');
  });
});
