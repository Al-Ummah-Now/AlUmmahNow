/**
 * Server-rendered cards use the stable /thumb image (#1209) with a srcset of its width variants;
 * any other source keeps the single image.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import VideoThumbnail from '../index';

describe('VideoThumbnail srcset', () => {
  it('should give a /thumb image its width variants and keep the path relative', () => {
    render(<VideoThumbnail src="/thumb/v1.jpg" alt="A video" sizes="320px" loading="high" />);
    const img = screen.getByTestId('thumbnail-image');
    expect(img).toHaveAttribute('src', '/thumb/v1.jpg');
    expect(img.getAttribute('srcset')).toBe('/thumb/v1.jpg?w=320 320w, /thumb/v1.jpg?w=480 480w, /thumb/v1.jpg?w=640 640w, /thumb/v1.jpg?w=1280 1280w');
    expect(img).toHaveAttribute('sizes', '320px');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('loading', 'eager');
  });

  it('should keep one image for another source', () => {
    render(<VideoThumbnail src="https://images.alummahnow.net/a.jpg" alt="A video" />);
    expect(screen.getByTestId('thumbnail-image').getAttribute('srcset')).toBeNull();
  });
});
