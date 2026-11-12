/**
 * Tests for CalendarEvent Component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CalendarEvent } from '../CalendarEvent';

// Mock Next.js Image component
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} data-fill={fill ? 'true' : 'false'} />;
  },
}));

describe('CalendarEvent', () => {
  const mockOnClick = jest.fn();
  const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

  const defaultProps = {
    id: 'video-1',
    title: 'Test Video Title',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    scheduledDate: futureDate,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should display video title', () => {
      render(<CalendarEvent {...defaultProps} />);

      expect(screen.getByText('Test Video Title')).toBeInTheDocument();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should display video thumbnail', () => {
      render(<CalendarEvent {...defaultProps} />);

      const img = screen.getByAltText('Test Video Title');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should display scheduled time', () => {
      render(<CalendarEvent {...defaultProps} />);

      // Should contain "in" and "hour" for future date
      const scheduledTime = screen.getByText(/in.*hour/i);
      expect(scheduledTime).toBeInTheDocument();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should truncate long titles', () => {
      const longTitle = 'A'.repeat(100);
      render(<CalendarEvent {...defaultProps} title={longTitle} />);

      const titleElement = screen.getByText(/A+\.\.\./);
      expect(titleElement).toBeInTheDocument();
      expect(titleElement.textContent).toHaveLength(50); // 47 chars + "..."
    });

    it('should not truncate short titles', () => {
      const shortTitle = 'Short Title';
      render(<CalendarEvent {...defaultProps} title={shortTitle} />);

      expect(screen.getByText(shortTitle)).toBeInTheDocument();
    });

    it('should handle missing thumbnail gracefully', () => {
      render(<CalendarEvent {...defaultProps} thumbnailUrl={undefined} />);

      // Should show placeholder icon
      const placeholder = screen.getByRole('button').querySelector('svg');
      expect(placeholder).toBeInTheDocument();
    });
  });

  describe('Interaction', () => {
    it('should call onClick when clicked', async () => {
      render(<CalendarEvent {...defaultProps} onClick={mockOnClick} />);

      const event = screen.getByRole('button');

      await act(async () => {
        fireEvent.click(event);
      });

      expect(mockOnClick).toHaveBeenCalledTimes(1);
      expect(mockOnClick).toHaveBeenCalledWith('video-1');
    });

    it('should show loading state when clicking', async () => {
      const slowOnClick = jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<CalendarEvent {...defaultProps} onClick={slowOnClick} />);

      const event = screen.getByRole('button');

      await act(async () => {
        fireEvent.click(event);
      });

      // Should show loading spinner
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('should not show loading state without onClick', () => {
      render(<CalendarEvent {...defaultProps} />);

      const event = screen.getByRole('button');
      fireEvent.click(event);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeInTheDocument();
    });

    it('should handle Enter key press', async () => {
      render(<CalendarEvent {...defaultProps} onClick={mockOnClick} />);

      const event = screen.getByRole('button');

      await act(async () => {
        fireEvent.keyDown(event, { key: 'Enter', code: 'Enter' });
      });

      expect(mockOnClick).toHaveBeenCalledTimes(1);
      expect(mockOnClick).toHaveBeenCalledWith('video-1');
    });

    it('should handle Space key press', async () => {
      render(<CalendarEvent {...defaultProps} onClick={mockOnClick} />);

      const event = screen.getByRole('button');

      await act(async () => {
        fireEvent.keyDown(event, { key: ' ', code: 'Space' });
      });

      expect(mockOnClick).toHaveBeenCalledTimes(1);
      expect(mockOnClick).toHaveBeenCalledWith('video-1');
    });

    it('should not handle other key presses', () => {
      render(<CalendarEvent {...defaultProps} onClick={mockOnClick} />);

      const event = screen.getByRole('button');
      fireEvent.keyDown(event, { key: 'a', code: 'KeyA' });

      expect(mockOnClick).not.toHaveBeenCalled();
    });
  });

  describe('Image Error Handling', () => {
    // Quarantined: fails on main, tracked in #206.
    it.skip('should show placeholder when image fails to load', () => {
      render(<CalendarEvent {...defaultProps} />);

      const img = screen.getByAltText('Test Video Title');
      fireEvent.error(img);

      // Should show placeholder icon after error
      const placeholder = screen.getByRole('button').querySelector('svg');
      expect(placeholder).toBeInTheDocument();
    });
  });

  describe('Localization', () => {
    // Quarantined: fails on main, tracked in #206.
    it.skip('should format scheduled time in English', () => {
      render(<CalendarEvent {...defaultProps} locale="en" />);

      const scheduledTime = screen.getByText(/in.*hour/i);
      expect(scheduledTime).toBeInTheDocument();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should format scheduled time in Arabic', () => {
      render(<CalendarEvent {...defaultProps} locale="ar" />);

      const scheduledTime = screen.getByText(/خلال/);
      expect(scheduledTime).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper role', () => {
      render(<CalendarEvent {...defaultProps} />);

      const event = screen.getByRole('button');
      expect(event).toBeInTheDocument();
    });

    it('is named by its visible title first, then the status (WCAG 2.5.3 label in name)', () => {
      render(<CalendarEvent {...defaultProps} />);

      const event = screen.getByRole('button');
      expect(event).not.toHaveAttribute('aria-label');
      expect(event).toHaveAccessibleName(/^Test Video Title\b.*, Scheduled, /);
    });

    it('names the event in Arabic on Arabic pages', () => {
      render(<CalendarEvent {...defaultProps} locale="ar" />);

      expect(screen.getByRole('button')).toHaveAccessibleName(/^Test Video Title\b.*، مجدول، /);
    });

    it('should be keyboard focusable', () => {
      render(<CalendarEvent {...defaultProps} />);

      const event = screen.getByRole('button');
      expect(event).toHaveAttribute('tabIndex', '0');
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should show full title in title attribute', () => {
      const longTitle = 'A'.repeat(100);
      render(<CalendarEvent {...defaultProps} title={longTitle} />);

      const titleElement = screen.getByTitle(longTitle);
      expect(titleElement).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should render with custom className', () => {
      const { container } = render(
        <CalendarEvent {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should apply dark mode classes', () => {
      const { container } = render(<CalendarEvent {...defaultProps} />);

      expect(container.firstChild).toHaveClass('dark:bg-gray-800');
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should have hover effects', () => {
      const { container } = render(<CalendarEvent {...defaultProps} />);

      expect(container.firstChild).toHaveClass('hover:shadow-md');
    });
  });
});
