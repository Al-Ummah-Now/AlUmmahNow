import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

import { ThumbnailCropper, renderCrop } from '../ThumbnailCropper';

const drawImage = jest.fn();
beforeEach(() => {
  drawImage.mockClear();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage, imageSmoothingQuality: 'low' }) as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/jpeg' }));
  };
});

describe('ThumbnailCropper', () => {
  it('frames the picture at the video shape and explains the sizes', () => {
    render(<ThumbnailCropper open src="blob:x" image={{ width: 1920, height: 1080 }} video={{ width: 1080, height: 1920 }} onCancel={() => {}} onConfirm={() => {}} />);
    const frame = screen.getByTestId('thumbnail-crop-frame');
    expect(frame.getAttribute('data-aspect')).toBe((1080 / 1920).toFixed(4));
    expect(frame.style.aspectRatio).toBe('1080 / 1920');
    expect(screen.getByTestId('thumbnail-cropper').textContent).toContain('1920×1080');
    expect(screen.getByTestId('thumbnail-cropper').textContent).toContain('9:16');
  });

  it('arrow keys move the picture inside the frame', () => {
    render(<ThumbnailCropper open src="blob:x" image={{ width: 1920, height: 1080 }} video={{ width: 1080, height: 1920 }} onCancel={() => {}} onConfirm={() => {}} />);
    const img = screen.getByTestId('thumbnail-crop-image');
    const before = img.style.left;
    fireEvent.keyDown(screen.getByTestId('thumbnail-crop-frame'), { key: 'ArrowRight' });
    expect(img.style.left).not.toBe(before);
    expect(parseFloat(img.style.left)).toBeLessThan(parseFloat(before));
  });

  it('confirm draws the crop at the video shape and hands back a JPEG', async () => {
    const onConfirm = jest.fn();
    render(<ThumbnailCropper open src="blob:x" image={{ width: 1920, height: 1080 }} video={{ width: 1080, height: 1920 }} filename="art.png" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('thumbnail-crop-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const file = onConfirm.mock.calls[0][0] as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('art.jpg');
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0];
    expect(sw / sh).toBeCloseTo(9 / 16, 6);
    expect(dw / dh).toBeCloseTo(9 / 16, 2);
    expect([sx, sy, dx, dy]).toEqual([expect.closeTo(656.25, 4), 0, 0, 0]);
    expect([dw, dh]).toEqual([720, 1280]);
  });

  it('renderCrop never stretches: source and output share the aspect', async () => {
    const file = await renderCrop({} as HTMLImageElement, { width: 1000, height: 1000 }, { width: 1920, height: 1080 }, 1.5, { x: 1, y: -1 });
    expect(file.name).toBe('thumbnail.jpg');
    const [, , , sw, sh, , , dw, dh] = drawImage.mock.calls[0];
    expect(sw / sh).toBeCloseTo(dw / dh, 2);
  });

  it('cancel closes without a file', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(<ThumbnailCropper open src="blob:x" image={{ width: 800, height: 800 }} video={{ width: 1920, height: 1080 }} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('thumbnail-crop-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
