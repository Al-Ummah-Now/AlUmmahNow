/**
 * Post images (covers, cards, link previews) and image posts upload through uploadPostImage. A file
 * over the 5 MB limit is never sent; a 413 from the API (code file_too_large) shows the same
 * message naming the file and the limit instead of the generic upload error.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMMUNITY_UPLOAD_LIMITS } from '@al-ummah/shared-types';
import { PostImageField, uploadPostImage } from '../management/forms/PostImageField';
import { uploadCommunityImages } from '@/lib/api/community-posts';
import { MB, sizedFile } from './upload-limits-test-helpers';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));
jest.mock('@/lib/api/community-posts', () => ({ uploadCommunityImages: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));

const upload = jest.mocked(uploadCommunityImages);

beforeEach(() => {
  upload.mockReset();
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = jest.fn(async () => ({ width: 640, height: 480, close: () => {} }));
});

function renderField() {
  const onChange = jest.fn();
  render(<PostImageField channelId="c1" label="Cover" value={null} onChange={onChange} />);
  const input = screen.getByLabelText('Cover') as HTMLInputElement;
  return { onChange, input };
}

describe('community post image size limit', () => {
  it('uploadPostImage never sends a file over the limit', async () => {
    const result = await uploadPostImage('c1', sizedFile('photo.jpg', 12.4 * MB, 'image/jpeg'), null);
    expect(result).toEqual({ ok: false, tooLarge: { fileName: 'photo.jpg', size: 12.4 * MB, maxBytes: COMMUNITY_UPLOAD_LIMITS.imageBytes } });
    expect(upload).not.toHaveBeenCalled();
  });

  it('the field names the file and the limit and uploads nothing', async () => {
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { files: [sizedFile('photo.jpg', 12.4 * MB, 'image/jpeg')] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('photo.jpg is 12.4 MB. Images can be up to 5 MB.');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uploads an image exactly at the limit', async () => {
    upload.mockResolvedValue({ ok: true, images: [{ url: 'https://images.alummahnow.net/community-posts/c1/a.jpg', width: 1200, height: 800, size: 1, mimeType: 'image/jpeg' }] });
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { files: [sizedFile('ok.jpg', COMMUNITY_UPLOAD_LIMITS.imageBytes, 'image/jpeg')] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://images.alummahnow.net/community-posts/c1/a.jpg', width: 640 })));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('maps the API refusing the size (413) to the same message', async () => {
    upload.mockResolvedValue({ ok: false, tooLarge: { fileName: 'scan.png', size: 4.5 * MB, maxBytes: 4 * MB } });
    const { input } = renderField();
    fireEvent.change(input, { target: { files: [sizedFile('scan.png', 4.5 * MB, 'image/png')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('scan.png is 4.5 MB. Images can be up to 4 MB.');
  });

  it('other upload failures keep the generic message', async () => {
    upload.mockResolvedValue({ ok: false, tooLarge: null });
    const { input } = renderField();
    fireEvent.change(input, { target: { files: [sizedFile('a.png', MB, 'image/png')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The image could not be uploaded. Try again.');
  });
});
