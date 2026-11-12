import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

const uploadVideoThumbnail = jest.fn();
jest.mock('@/lib/api/video-thumbnail-client', () => ({
  ...jest.requireActual('@/lib/api/video-thumbnail-client'),
  uploadVideoThumbnail: (...args: unknown[]) => uploadVideoThumbnail(...args),
}));

const loadImageFile = jest.fn();
const cropped = new File(['c'], 'art.jpg', { type: 'image/jpeg' });
jest.mock('@/components/VideoThumbnail/ThumbnailCropper', () => ({
  loadImageFile: (f: File) => loadImageFile(f),
  ThumbnailCropper: ({ video, onConfirm, onCancel }: { video: { width: number; height: number }; onConfirm: (f: File) => void; onCancel: () => void }) => (
    <div data-testid="cropper" data-video={`${video.width}x${video.height}`}>
      <button onClick={() => onConfirm(cropped)}>use</button>
      <button onClick={onCancel}>cancel</button>
    </div>
  ),
}));

import ThumbnailSelector from '../ThumbnailSelector';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

const vertical = { videoWidth: 1080, videoHeight: 1920 };
const pick = (name = 'art.png') => {
  const file = new File(['x'], name, { type: 'image/png' });
  fireEvent.change(screen.getByTestId('thumbnail-file-input'), { target: { files: [file] } });
  return file;
};

beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = jest.fn();
});
beforeEach(() => {
  uploadVideoThumbnail.mockReset();
  loadImageFile.mockReset();
});

describe('studio editor custom thumbnail: cropped to the video shape', () => {
  it('an image of another shape opens the cropper; the crop is what gets uploaded', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 1920, height: 1080 } });
    uploadVideoThumbnail.mockResolvedValue({ success: true, thumbnailUrl: 'https://cdn/t.jpg' });
    const onChange = jest.fn();
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={onChange} {...vertical} />);
    pick();
    const cropper = await screen.findByTestId('cropper');
    expect(cropper.getAttribute('data-video')).toBe('1080x1920');
    expect(uploadVideoThumbnail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('use'));
    await waitFor(() => expect(uploadVideoThumbnail).toHaveBeenCalledWith('v1', cropped, 'c1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/t.jpg'));
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('an image already of the video shape uploads without the cropper', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 720, height: 1280 } });
    uploadVideoThumbnail.mockResolvedValue({ success: true, thumbnailUrl: 'https://cdn/t.jpg' });
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    const file = pick();
    await waitFor(() => expect(uploadVideoThumbnail).toHaveBeenCalledWith('v1', file, 'c1'));
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('cancelling the crop uploads nothing', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 1920, height: 1080 } });
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    pick();
    fireEvent.click(await screen.findByText('cancel'));
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(uploadVideoThumbnail).not.toHaveBeenCalled();
  });

  it('a refusal for the shape shows the crop message', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 720, height: 1280 } });
    uploadVideoThumbnail.mockResolvedValue({ success: false, code: 'thumbnail_shape', error: 'server text' });
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    pick();
    expect(await screen.findByTestId('thumbnail-upload-error')).toHaveTextContent(EN_TRANSLATIONS.video.thumbnailWrongShape);
  });
});

describe('studio editor custom thumbnail: drag and drop', () => {
  const dropOn = (file: File) => {
    const zone = screen.getByTestId('thumbnail-upload-button');
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveAttribute('data-drag-over', 'true');
    expect(zone).toHaveTextContent(EN_TRANSLATIONS.upload.thumbnailDropHere);
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).toHaveAttribute('data-drag-over', 'false');
  };

  it('a dropped image takes the picker path: crop, then upload', async () => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 1920, height: 1080 } });
    uploadVideoThumbnail.mockResolvedValue({ success: true, thumbnailUrl: 'https://cdn/t.jpg' });
    const onChange = jest.fn();
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={onChange} {...vertical} />);
    dropOn(new File(['x'], 'art.png', { type: 'image/png' }));
    await screen.findByTestId('cropper');
    fireEvent.click(screen.getByText('use'));
    await waitFor(() => expect(uploadVideoThumbnail).toHaveBeenCalledWith('v1', cropped, 'c1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/t.jpg'));
  });

  it.each([
    ['image/jpeg', 'a.jpg'],
    ['image/webp', 'a.webp'],
  ])('a dropped %s of the video shape uploads directly', async (type, name) => {
    loadImageFile.mockResolvedValue({ url: 'blob:art', size: { width: 720, height: 1280 } });
    uploadVideoThumbnail.mockResolvedValue({ success: true, thumbnailUrl: 'https://cdn/t.jpg' });
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    const file = new File(['x'], name, { type });
    dropOn(file);
    await waitFor(() => expect(uploadVideoThumbnail).toHaveBeenCalledWith('v1', file, 'c1'));
  });

  it('a dropped file of another type shows the friendly type error and uploads nothing', async () => {
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    dropOn(new File(['x'], 'anim.gif', { type: 'image/gif' }));
    expect(await screen.findByTestId('thumbnail-upload-error')).toHaveTextContent(EN_TRANSLATIONS.video.thumbnailInvalidType);
    expect(uploadVideoThumbnail).not.toHaveBeenCalled();
  });

  it('a dropped image over the size limit shows the size error', async () => {
    render(<ThumbnailSelector videoId="v1" currentThumbnailUrl="" channelId="c1" onThumbnailChange={() => {}} {...vertical} />);
    dropOn(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByTestId('thumbnail-upload-error')).toHaveTextContent(EN_TRANSLATIONS.video.thumbnailTooLarge);
    expect(uploadVideoThumbnail).not.toHaveBeenCalled();
  });
});
