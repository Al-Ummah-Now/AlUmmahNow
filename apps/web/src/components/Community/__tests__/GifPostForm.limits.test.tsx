/**
 * GIF posts: the composer refuses GIFs over the API's limit (10 MB, shared with api-videos through
 * @al-ummah/shared-types) and says which file and what the limit is, in an alert tied to the field.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COMMUNITY_UPLOAD_LIMITS } from '@al-ummah/shared-types';
import { GifPostForm } from '../management/forms/GifPostForm';
import { MB, installLoadingImage, sizedFile } from './upload-limits-test-helpers';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));

let restore: () => void;
beforeEach(() => {
  restore = installLoadingImage();
});
afterEach(() => restore());

function pick(file: File) {
  const input = document.getElementById('gif-upload') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

describe('GifPostForm size limit', () => {
  it('refuses a GIF over 10 MB with a message naming the file and the limit', async () => {
    const onChange = jest.fn();
    render(<GifPostForm gif={null} onChange={onChange} locale="en" />);
    const input = pick(sizedFile('dance.gif', 14.2 * MB, 'image/gif'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dance.gif is 14.2 MB. GIFs can be up to 10 MB.');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a GIF exactly at the limit', async () => {
    const onChange = jest.fn();
    render(<GifPostForm gif={null} onChange={onChange} locale="en" />);
    pick(sizedFile('ok.gif', COMMUNITY_UPLOAD_LIMITS.gifBytes, 'image/gif'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 })));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
