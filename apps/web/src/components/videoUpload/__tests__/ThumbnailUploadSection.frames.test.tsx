import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
// A short or still clip: every extracted frame is the same picture
jest.mock('@/lib/utils/videoFrameExtractor', () => ({
  extractVideoFrames: jest.fn().mockResolvedValue(Array(5).fill('data:image/jpeg;base64,same')),
  probeVideoSize: jest.fn().mockResolvedValue({ width: 1280, height: 720 }),
}));
jest.mock('@/lib/utils/thumbnailValidator', () => ({
  validateThumbnailFile: jest.fn().mockResolvedValue({ valid: true }),
  fileToBase64: jest.fn(),
}));
jest.mock('@/components/VideoThumbnail/FitImage', () => ({ FitImage: () => null }));
jest.mock('@/components/VideoThumbnail/ThumbnailCropper', () => ({ loadImageFile: jest.fn(), ThumbnailCropper: () => null }));

import { ThumbnailUploadSection } from '../ThumbnailUploadSection';

global.URL.revokeObjectURL = jest.fn();

describe('upload page thumbnail frames', () => {
  it('only the clicked frame is selected, even when frames are the same picture', async () => {
    const onSelect = jest.fn();
    render(<ThumbnailUploadSection videoFile={new File(['v'], 'clip.mp4', { type: 'video/mp4' })} onThumbnailSelect={onSelect} />);
    await screen.findByTestId('upload-thumbnail-frames');
    const frames = screen.getAllByTestId('upload-thumbnail-frame');
    expect(frames).toHaveLength(5);
    fireEvent.click(frames[2]);
    expect(frames.map((f) => f.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'auto', position: 50 }));
  });
});
