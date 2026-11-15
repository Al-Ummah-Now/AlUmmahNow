/**
 * Image posts: the composer refuses images over the API's limit (5 MB, shared with api-videos through
 * @al-ummah/shared-types) before anything is uploaded, naming the file and the limit in an alert tied
 * to the field. It allowed 16 MB, so the server refused it with a generic error.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMMUNITY_UPLOAD_LIMITS } from '@al-ummah/shared-types';
import { ImagePostForm } from '../management/forms/ImagePostForm';
import { MB, installLoadingImage, sizedFile } from './upload-limits-test-helpers';

let lang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: lang === 'ar' ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    locale: lang,
    isRTL: lang === 'ar',
  }),
}));

let restore: () => void;
beforeEach(() => {
  lang = 'en';
  restore = installLoadingImage();
});
afterEach(() => restore());

function pick(files: File[]) {
  const input = document.getElementById('image-upload') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  return input;
}

describe('ImagePostForm size limit', () => {
  it('refuses an image over 5 MB with a message naming the file and the limit', async () => {
    const onChange = jest.fn();
    render(<ImagePostForm images={[]} onChange={onChange} locale="en" />);
    const input = pick([sizedFile('photo.jpg', 12.4 * MB, 'image/jpeg')]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('photo.jpg is 12.4 MB. Images can be up to 5 MB.');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.every(([images]) => images.length === 0)).toBe(true);
  });

  it('accepts an image exactly at the limit', async () => {
    const onChange = jest.fn();
    render(<ImagePostForm images={[]} onChange={onChange} locale="en" />);
    pick([sizedFile('ok.jpg', COMMUNITY_UPLOAD_LIMITS.imageBytes, 'image/jpeg')]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ size: COMMUNITY_UPLOAD_LIMITS.imageBytes, width: 800 })]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the files that fit and names each one that does not', async () => {
    const onChange = jest.fn();
    render(<ImagePostForm images={[]} onChange={onChange} locale="en" />);
    pick([sizedFile('a.png', 1 * MB, 'image/png'), sizedFile('big.png', 6 * MB, 'image/png')]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ mimeType: 'image/png', size: MB })]));
    expect(screen.getByRole('alert')).toHaveTextContent('big.png is 6 MB. Images can be up to 5 MB.');
  });

  it('says it in Arabic with the sizes in Arabic', async () => {
    lang = 'ar';
    render(<ImagePostForm images={[]} onChange={jest.fn()} locale="ar" />);
    pick([sizedFile('صورة.jpg', 12.4 * MB, 'image/jpeg')]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('صورة.jpg');
    expect(alert.textContent).toContain('ميغابايت');
    expect(alert.textContent).toMatch(/5 ميغابايت/);
  });

  it('shows the real limit in the hint', () => {
    render(<ImagePostForm images={[]} onChange={jest.fn()} locale="en" />);
    expect(screen.getByText('JPG, PNG, GIF, WEBP – up to 5 MB')).toBeInTheDocument();
  });
});
