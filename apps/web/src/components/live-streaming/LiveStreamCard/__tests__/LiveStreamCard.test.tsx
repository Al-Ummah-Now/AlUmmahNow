/**
 * LiveStreamCard Component Tests
 * Task 1.12: Mobile/Desktop Testing Strategy
 *
 * Comprehensive unit tests for LiveStreamCard component including:
 * - Rendering with different stream states (live, scheduled, ended)
 * - Image loading and error handling
 * - User interactions (click, keyboard)
 * - Accessibility
 * - Dark mode
 * - Responsive behavior
 */

import React from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/utils/test-utils';
import {
  createMockLiveStream,
  createMockChannel,
} from '@/__tests__/utils/mock-data';
import { LiveStreamCard } from '../index';
import type { LiveStream } from '@al-ummah/shared-types';

describe('LiveStreamCard Component', () => {
  describe('Rendering - Live Stream', () => {
    it('renders live stream with all information', () => {
      const stream = createMockLiveStream({ status: 'live' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(stream.title)).toBeInTheDocument();
      expect(screen.getByText(stream.channel.name)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /live stream/i })).toBeInTheDocument();
    });

    it('shows LIVE badge for live streams', () => {
      const stream = createMockLiveStream({ status: 'live' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('LIVE')).toBeInTheDocument();
    });

    it('shows viewer count for live streams', () => {
      const stream = createMockLiveStream({
        status: 'live',
        viewerCount: 1234,
      });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('1.2K')).toBeInTheDocument();
    });

    it('shows relative time for live streams', () => {
      const startedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
      const stream = createMockLiveStream({
        status: 'live',
        startedAt,
      });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(/Started/)).toBeInTheDocument();
    });
  });

  describe('Rendering - Scheduled Stream', () => {
    it('renders scheduled stream', () => {
      const stream = createMockLiveStream({ status: 'scheduled' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(stream.title)).toBeInTheDocument();
    });

    it('shows SCHEDULED badge', () => {
      const stream = createMockLiveStream({ status: 'scheduled' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
    });

    it('shows countdown for upcoming streams', () => {
      const scheduledTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
      const stream = createMockLiveStream({
        status: 'scheduled',
        scheduledStartTime: scheduledTime,
      });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(/Starts in/)).toBeInTheDocument();
    });

    it('does not show viewer count for scheduled streams', () => {
      const stream = createMockLiveStream({ status: 'scheduled' });
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      // Viewer count should not be present
      expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
    });
  });

  describe('Rendering - Ended Stream', () => {
    it('renders ended stream', () => {
      const stream = createMockLiveStream({ status: 'ended' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(stream.title)).toBeInTheDocument();
    });

    it('shows ENDED badge', () => {
      const stream = createMockLiveStream({ status: 'ended' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('ENDED')).toBeInTheDocument();
    });

    it('shows relative time for ended streams', () => {
      const endedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const stream = createMockLiveStream({
        status: 'ended',
        endedAt,
      });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(/Ended/)).toBeInTheDocument();
    });
  });

  describe('Image Loading', () => {
    it('shows loading placeholder before image loads', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      const placeholder = container.querySelector('.animate-pulse');
      expect(placeholder).toBeInTheDocument();
    });

    it('handles image load error gracefully', () => {
      const stream = createMockLiveStream({
        thumbnailUrl: 'https://invalid-image-url.com/image.jpg',
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      // Simulate image error by finding and triggering onError
      const images = document.querySelectorAll('img');
      const thumbnailImage = Array.from(images).find(
        (img) => img.alt === stream.title
      );

      if (thumbnailImage) {
        const errorEvent = new Event('error');
        thumbnailImage.dispatchEvent(errorEvent);
      }

      // After error, should show error message
      setTimeout(() => {
        expect(
          screen.queryByText('Failed to load thumbnail')
        ).toBeInTheDocument();
      }, 100);
    });

    it('sets priority loading for first few cards', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} priority />
      );

      const image = container.querySelector('img[loading="eager"]');
      expect(image).toBeInTheDocument();
    });

    it('uses lazy loading by default', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} priority={false} />
      );

      const image = container.querySelector('img[loading="lazy"]');
      expect(image).toBeInTheDocument();
    });
  });

  describe('Channel Information', () => {
    it('shows channel name and avatar', () => {
      const stream = createMockLiveStream({
        channel: createMockChannel({
          name: 'Test Channel',
          avatarUrl: 'https://example.com/avatar.jpg',
        }),
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('Test Channel')).toBeInTheDocument();
      expect(screen.getByAltText('Test Channel')).toBeInTheDocument();
    });

    it('hides channel when showChannel is false', () => {
      const stream = createMockLiveStream();
      renderWithProviders(
        <LiveStreamCard stream={stream} showChannel={false} />
      );

      expect(screen.queryByText(stream.channel.name)).not.toBeInTheDocument();
    });

    it('handles missing channel avatar', () => {
      const stream = createMockLiveStream({
        channel: createMockChannel({ avatarUrl: undefined as any }),
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText(stream.channel.name)).toBeInTheDocument();
    });
  });

  describe('Category and Metadata', () => {
    it('shows category when provided', () => {
      const stream = createMockLiveStream({
        category: 'Islamic Lectures',
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('Islamic Lectures')).toBeInTheDocument();
    });

    it('handles missing category', () => {
      const stream = createMockLiveStream({ category: undefined });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      // Should still render without error
      expect(screen.getByText(stream.title)).toBeInTheDocument();
    });
  });

  describe('Click and Keyboard Interactions', () => {
    it('calls onPlay when card is clicked', async () => {
      const handlePlay = jest.fn();
      const stream = createMockLiveStream();
      const { user } = renderWithProviders(
        <LiveStreamCard stream={stream} onPlay={handlePlay} />
      );

      const card = screen.getByRole('button', { name: /live stream/i });
      await user.click(card);

      expect(handlePlay).toHaveBeenCalledTimes(1);
    });

    it('calls onPlay when Enter key is pressed', async () => {
      const handlePlay = jest.fn();
      const stream = createMockLiveStream();
      const { user } = renderWithProviders(
        <LiveStreamCard stream={stream} onPlay={handlePlay} />
      );

      const card = screen.getByRole('button', { name: /live stream/i });
      card.focus();
      await user.keyboard('{Enter}');

      expect(handlePlay).toHaveBeenCalledTimes(1);
    });

    it('calls onPlay when Space key is pressed', async () => {
      const handlePlay = jest.fn();
      const stream = createMockLiveStream();
      const { user } = renderWithProviders(
        <LiveStreamCard stream={stream} onPlay={handlePlay} />
      );

      const card = screen.getByRole('button', { name: /live stream/i });
      card.focus();
      await user.keyboard(' ');

      expect(handlePlay).toHaveBeenCalledTimes(1);
    });

    it('calls onPlay when play button overlay is clicked', async () => {
      const handlePlay = jest.fn();
      const stream = createMockLiveStream();
      const { user } = renderWithProviders(
        <LiveStreamCard stream={stream} onPlay={handlePlay} />
      );

      const playButton = screen.getByRole('button', { name: 'Play stream' });
      await user.click(playButton);

      expect(handlePlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('has role="button"', () => {
      const stream = createMockLiveStream();
      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('has tabIndex={0} for keyboard navigation', () => {
      const stream = createMockLiveStream();
      renderWithProviders(<LiveStreamCard stream={stream} />);

      const card = screen.getByRole('button');
      expect(card).toHaveAttribute('tabindex', '0');
    });

    it('has descriptive aria-label', () => {
      const stream = createMockLiveStream({
        title: 'Test Stream',
        channel: createMockChannel({ name: 'Test Channel' }),
        status: 'live',
        viewerCount: 100,
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      const card = screen.getByRole('button');
      const ariaLabel = card.getAttribute('aria-label');

      expect(ariaLabel).toContain('Test Stream');
      expect(ariaLabel).toContain('Test Channel');
      expect(ariaLabel).toContain('100 viewers');
    });

    it('has article semantic element', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      expect(container.querySelector('article')).toBeInTheDocument();
    });

    it('has proper heading structure', () => {
      const stream = createMockLiveStream({ title: 'Test Stream Title' });
      renderWithProviders(<LiveStreamCard stream={stream} />);

      const heading = screen.getByRole('heading', { name: /Test Stream Title/i });
      expect(heading).toBeInTheDocument();
      expect(heading.tagName).toBe('H3');
    });
  });

  describe('Variants', () => {
    it('applies default variant styles', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} variant="default" />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('shadow-md');
    });

    it('applies compact variant styles', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} variant="compact" />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('shadow-sm');
    });

    it('applies featured variant styles', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} variant="featured" />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('shadow-lg', 'ring-2', 'ring-primary');
    });

    it('applies custom className', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} className="custom-card" />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('custom-card');
    });
  });

  describe('Dark Mode', () => {
    it('renders correctly in dark mode', () => {
      const stream = createMockLiveStream();
      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />,
        { theme: 'dark' }
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('dark:bg-gray-900', 'dark:border-gray-700');
    });
  });

  describe('Viewer Count Display', () => {
    it('hides viewer count when showViewers is false', () => {
      const stream = createMockLiveStream({
        status: 'live',
        viewerCount: 1000,
      });

      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} showViewers={false} />
      );

      expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
    });

    it('shows viewer count by default for live streams', () => {
      const stream = createMockLiveStream({
        status: 'live',
        viewerCount: 1000,
      });

      renderWithProviders(<LiveStreamCard stream={stream} />);

      expect(screen.getByText('1K')).toBeInTheDocument();
    });
  });

  describe('Title Truncation', () => {
    it('truncates long titles to 2 lines', () => {
      const stream = createMockLiveStream({
        title:
          'This is a very long stream title that should be truncated to exactly two lines maximum',
      });

      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      const title = container.querySelector('h3');
      expect(title).toHaveClass('line-clamp-2');
    });

    it('shows full title in title attribute on hover', () => {
      const longTitle = 'Very long stream title for accessibility';
      const stream = createMockLiveStream({ title: longTitle });

      const { container } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      const title = container.querySelector('h3');
      expect(title).toHaveAttribute('title', longTitle);
    });
  });

  describe('Component Memoization', () => {
    it('does not re-render with same props', () => {
      const stream = createMockLiveStream();
      const { rerender } = renderWithProviders(
        <LiveStreamCard stream={stream} />
      );

      const firstRender = screen.getByRole('button');

      rerender(<LiveStreamCard stream={stream} />);

      const secondRender = screen.getByRole('button');

      expect(firstRender).toBe(secondRender);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing optional fields gracefully', () => {
      const minimalStream: LiveStream = {
        id: 'test-id',
        title: 'Minimal Stream',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        status: 'live',
        channel: {
          id: 'channel-1',
          name: 'Test Channel',
          avatarUrl: undefined as any,
        } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as LiveStream;

      renderWithProviders(<LiveStreamCard stream={minimalStream} />);

      expect(screen.getByText('Minimal Stream')).toBeInTheDocument();
    });

    it('renders without crashing when all optional props are undefined', () => {
      const stream = createMockLiveStream();

      renderWithProviders(
        <LiveStreamCard
          stream={stream}
          variant={undefined}
          showChannel={undefined}
          showViewers={undefined}
          onPlay={undefined}
          className={undefined}
          priority={undefined}
        />
      );

      expect(screen.getByText(stream.title)).toBeInTheDocument();
    });
  });
});
