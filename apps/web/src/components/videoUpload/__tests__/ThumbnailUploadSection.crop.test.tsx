import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));
jest.mock('@/lib/utils/videoFrameExtractor', () => ({
  extractVideoFrames: jest.fn().mockResolvedValue(['data:image/jpeg;base64,frame']),
  probeVideoSize: jest.fn().mockResolvedValue({ width: 1080, height: 1920 }),
}));
jest.mock('@/lib/utils/thumbnailValidator', () => ({
  validateThumbnailFile: jest.fn().mockResolvedValue({ valid: true }),
  fileToBase64: jest.fn(async (f: File) => `data:${f.type};base64,${f.name}`),
}));
jest.mock('@/components/VideoThumbnail/FitImage', () => ({ FitImage: () => null }));

const loadImageFile = jest.fn();
const cropped = new File(['c'], 'art.jpg', { type: 'image/jpeg' });
jest.mock('@/components/VideoThumbnail/ThumbnailCropper', () => ({
  loadImageFile: (f: File) => loadImageFile(f),
  ThumbnailCropper: ({ onConfirm }: { onConfirm: (f: File) => void }) => (
    <div data-testid="cropper"><button onClick={() => onConfirm(cropped)}>use</button></div>
  ),
}));

import { ThumbnailUploadSection } from '../ThumbnailUploadSection';

const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' });
global.URL.revokeObjectURL = jest.fn();

describe('upload page thumbnail: cropped to the video shape, size sent to the API', () => {
  beforeEach(() => loadImageFile.mockReset());

  it('a custom image of another shape is cropped first; the selection carries the video size', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 1920, height: 1080 } });
    const onSelect = jest.fn();
    render(<ThumbnailUploadSection videoFile={video} onThumbnailSelect={onSelect} />);
    await screen.findByTestId('upload-thumbnail-frames');
    fireEvent.change(screen.getByTestId('upload-thumbnail-input'), { target: { files: [new File(['x'], 'art.png', { type: 'image/png' })] } });
    await screen.findByTestId('cropper');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('use'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0]).toMatchObject({ type: 'custom', filename: 'art.jpg', data: 'data:image/jpeg;base64,art.jpg', video: { width: 1080, height: 1920 } });
  });

  it('a custom image of the video shape is used as is', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 720, height: 1280 } });
    const onSelect = jest.fn();
    render(<ThumbnailUploadSection videoFile={video} onThumbnailSelect={onSelect} />);
    await screen.findByTestId('upload-thumbnail-frames');
    fireEvent.change(screen.getByTestId('upload-thumbnail-input'), { target: { files: [new File(['x'], 'tall.png', { type: 'image/png' })] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(onSelect.mock.calls[0][0]).toMatchObject({ type: 'custom', filename: 'tall.png', video: { width: 1080, height: 1920 } });
  });

  it('a picked frame carries the video size too', async () => {
    const onSelect = jest.fn();
    render(<ThumbnailUploadSection videoFile={video} onThumbnailSelect={onSelect} />);
    await waitFor(() => expect(screen.getAllByTestId('upload-thumbnail-frame').length).toBe(1));
    await waitFor(() => {
      fireEvent.click(screen.getAllByTestId('upload-thumbnail-frame')[0]);
      expect(onSelect.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'auto', video: { width: 1080, height: 1920 } });
    });
  });
});
