import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FitImage } from '../FitImage';
import VideoThumbnail from '..';

const BOX = { position: 'relative', height: 180 } as const;

/**
 * Pretend the image loaded at `natural` inside a box of `box` (jsdom has no
 * layout). next/image reports onLoad after img.decode(), a microtask later.
 */
async function load(img: HTMLElement, natural: [number, number], box: [number, number] = [320, 180]) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: natural[0] });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: natural[1] });
  img.getBoundingClientRect = () => ({ width: box[0], height: box[1] }) as DOMRect;
  await act(async () => {
    fireEvent.load(img);
    await Promise.resolve();
  });
}

describe('FitImage', () => {
  it('a 16:9 thumbnail covers its 16:9 box, with no backdrop', async () => {
    render(<div style={BOX}><FitImage src="https://cdn/a.jpg" alt="Lecture" /></div>);
    const img = screen.getByTestId('thumbnail-image');
    await load(img, [1280, 720]);
    expect(img).toHaveAttribute('data-fit', 'cover');
    expect(img).toHaveClass('object-cover');
    expect(screen.queryByTestId('thumbnail-backdrop')).toBeNull();
  });

  it.each([
    ['9:16', [1080, 1920]],
    ['1:1', [1440, 1440]],
    ['4:3', [640, 480]],
  ] as Array<[string, [number, number]]>)('a %s thumbnail is shown whole over a blurred, decorative backdrop', async (_l, natural) => {
    render(<div style={BOX}><FitImage src="https://cdn/v.jpg" alt="Short" /></div>);
    const img = screen.getByTestId('thumbnail-image');
    await load(img, natural);
    expect(img).toHaveAttribute('data-fit', 'contain');
    expect(img).toHaveClass('object-contain');
    const backdrop = screen.getByTestId('thumbnail-backdrop');
    expect(backdrop.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(backdrop).toHaveAttribute('alt', '');
    expect(backdrop).toHaveAttribute('src', 'https://cdn/v.jpg');
  });

  it("letterboxes from the first paint when Bunny's stored size says vertical", () => {
    render(<div style={BOX}><FitImage src="https://cdn/v.jpg" alt="Short" videoWidth={1080} videoHeight={1920} /></div>);
    expect(screen.getByTestId('thumbnail-image')).toHaveAttribute('data-fit', 'contain');
  });

  it('a landscape thumbnail in a 9:16 shorts box is letterboxed, a vertical one covers it', async () => {
    const { unmount } = render(<div style={BOX}><FitImage src="https://cdn/l.jpg" alt="x" /></div>);
    await load(screen.getByTestId('thumbnail-image'), [1280, 720], [180, 320]);
    expect(screen.getByTestId('thumbnail-image')).toHaveAttribute('data-fit', 'contain');
    unmount();
    render(<div style={BOX}><FitImage src="https://cdn/v.jpg" alt="x" /></div>);
    await load(screen.getByTestId('thumbnail-image'), [1080, 1920], [180, 320]);
    expect(screen.getByTestId('thumbnail-image')).toHaveAttribute('data-fit', 'cover');
  });

  it('a new src is measured again', async () => {
    const { rerender } = render(<div style={BOX}><FitImage src="https://cdn/v.jpg" alt="x" /></div>);
    await load(screen.getByTestId('thumbnail-image'), [1080, 1920]);
    expect(screen.getByTestId('thumbnail-image')).toHaveAttribute('data-fit', 'contain');
    rerender(<div style={BOX}><FitImage src="https://cdn/w.jpg" alt="x" /></div>);
    expect(screen.getByTestId('thumbnail-image')).toHaveAttribute('data-fit', 'cover');
  });
});

describe('VideoThumbnail', () => {
  it('passes the video size through, so a vertical video card letterboxes', () => {
    render(<VideoThumbnail src="https://cdn/v.jpg" alt="Short" videoWidth={720} videoHeight={1280} />);
    expect(screen.getByAltText('Short')).toHaveAttribute('data-fit', 'contain');
  });

  it('still shows the placeholder when the image fails', () => {
    render(<VideoThumbnail src="https://cdn/broken.jpg" alt="Broken" />);
    fireEvent.error(screen.getByTestId('thumbnail-image'));
    expect(screen.getByTestId('video-thumbnail-placeholder')).toBeInTheDocument();
  });
});
