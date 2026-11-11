/**
 * The hero frame's image: a real <img> (alt, srcset, size, high priority), filling the 16:9 frame
 * for a landscape video and shown whole over a blurred copy for a vertical one.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeroThumb, HomeHero } from '../HomeHero';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ lang: 'en', t: {}, isRTL: false }) }));

const video = (extra: Record<string, unknown>) =>
  ({
    id: 'v1',
    title: 'Tafsir of Al-Fatiha',
    channelName: 'Lectures',
    thumbnailUrl: 'https://images.example/v1.jpg',
    ...extra,
  }) as never;

function loadImage(img: HTMLElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  fireEvent.load(img);
}

describe('HeroThumb', () => {
  it('renders a landscape video as a covering, prioritised image with alt text and srcset', () => {
    render(
      <HomeHero
        video={video({
          width: 1920,
          height: 1080,
          duration: 600,
          thumbnailSizes: { hd: 'https://images.example/v1.jpg?width=1280', sd: 'https://images.example/v1.jpg?width=640' },
        })}
      />
    );
    const frame = screen.getByTestId('hero-thumb');
    expect(frame).toHaveAttribute('data-fit', 'cover');
    expect(frame).not.toHaveAttribute('style');
    expect(screen.queryByTestId('hero-thumb-backdrop')).toBeNull();
    const img = screen.getByRole('img', { name: 'Tafsir of Al-Fatiha' });
    expect(img).toHaveAttribute('src', 'https://images.example/v1.jpg');
    expect(img).toHaveAttribute('srcset', expect.stringContaining('640w'));
    expect(img).toHaveAttribute('sizes');
    expect(img).toHaveAttribute('width', '1920');
    expect(img).toHaveAttribute('height', '1080');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('loading', 'eager');
    // The link is named by the image
    expect(screen.getAllByRole('link', { name: /Tafsir of Al-Fatiha/ })[0]).toBe(frame);
  });

  it('shows a Short whole over a decorative blurred copy from the first paint', () => {
    render(<HeroThumb video={video({ width: 1080, height: 1920, duration: 40 })} href="/en/video?vid=v1" alt="Short" />);
    expect(screen.getByTestId('hero-thumb')).toHaveAttribute('data-fit', 'contain');
    const backdrop = screen.getByTestId('hero-thumb-backdrop');
    expect(backdrop).toHaveAttribute('alt', '');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it("switches to the loaded image's own shape", () => {
    render(<HeroThumb video={video({ width: 1920, height: 1080 })} href="/x" alt="Vertical thumb" />);
    const frame = screen.getByTestId('hero-thumb');
    expect(frame).toHaveAttribute('data-fit', 'cover');
    loadImage(screen.getByTestId('hero-thumb-image'), 720, 1280);
    expect(frame).toHaveAttribute('data-fit', 'contain');
    expect(screen.getByTestId('hero-thumb-backdrop')).toBeInTheDocument();
  });

  it('keeps the frame with no image when the video has no thumbnail', () => {
    render(<HeroThumb video={video({ thumbnailUrl: '' })} href="/x" label="Watch: Untitled" alt="Untitled"><span>play</span></HeroThumb>);
    expect(screen.queryByTestId('hero-thumb-image')).toBeNull();
    expect(screen.getByRole('link', { name: 'Watch: Untitled' })).toHaveTextContent('play');
  });
});
