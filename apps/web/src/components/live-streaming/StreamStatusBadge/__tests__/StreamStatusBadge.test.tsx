/**
 * Unit Tests for StreamStatusBadge Component
 * Task 1.1: Stream Status Badge Component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StreamStatusBadge } from '../index';
import { StreamStatusBadgeRTL } from '../rtl/index';

describe('StreamStatusBadge (LTR)', () => {
  describe('Status Variants', () => {
    it('renders live status with pulse animation', () => {
      render(<StreamStatusBadge status="live" />);
      const badge = screen.getByRole('status');

      expect(screen.getByText('LIVE')).toBeInTheDocument();
      expect(badge).toHaveClass('animate-pulse');
      expect(badge).toHaveClass('bg-red-500');
    });

    it('renders scheduled status', () => {
      render(<StreamStatusBadge status="scheduled" />);
      const badge = screen.getByRole('status');

      expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
      expect(badge).toHaveClass('bg-amber-500');
      expect(badge).not.toHaveClass('animate-pulse');
    });

    it('renders ended status', () => {
      render(<StreamStatusBadge status="ended" />);
      const badge = screen.getByRole('status');

      expect(screen.getByText('ENDED')).toBeInTheDocument();
      expect(badge).toHaveClass('bg-gray-500');
    });

    it('renders cancelled status', () => {
      render(<StreamStatusBadge status="cancelled" />);
      const badge = screen.getByRole('status');

      expect(screen.getByText('CANCELLED')).toBeInTheDocument();
      expect(badge).toHaveClass('bg-gray-600');
    });

    it('renders offline status', () => {
      render(<StreamStatusBadge status="offline" />);
      const badge = screen.getByRole('status');

      expect(screen.getByText('OFFLINE')).toBeInTheDocument();
      expect(badge).toHaveClass('bg-gray-400');
    });
  });

  describe('Icons', () => {
    it('renders icon when showIcon is true', () => {
      const { container } = render(<StreamStatusBadge status="live" showIcon />);
      const icon = container.querySelector('svg');

      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('does not render icon when showIcon is false', () => {
      const { container } = render(<StreamStatusBadge status="live" showIcon={false} />);
      const icon = container.querySelector('svg');

      expect(icon).not.toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    it('applies small size classes', () => {
      render(<StreamStatusBadge status="live" size="sm" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveClass('h-5', 'text-[10px]', 'px-1.5');
    });

    it('applies medium size classes (default)', () => {
      render(<StreamStatusBadge status="live" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveClass('h-6', 'text-xs', 'px-2');
    });

    it('applies large size classes', () => {
      render(<StreamStatusBadge status="live" size="lg" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveClass('h-7', 'text-sm', 'px-3');
    });
  });

  describe('Custom ClassName', () => {
    it('applies custom className', () => {
      const customClass = 'custom-test-class';
      render(<StreamStatusBadge status="live" className={customClass} />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveClass(customClass);
    });
  });

  describe('Accessibility', () => {
    it('has proper role and aria-label', () => {
      render(<StreamStatusBadge status="live" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveAttribute('aria-label');
      expect(badge.getAttribute('aria-label')).toContain('Stream status');
    });

    it('includes screen reader text for scheduled streams', () => {
      const scheduledTime = new Date('2024-12-31T20:00:00Z');
      render(<StreamStatusBadge status="scheduled" scheduledTime={scheduledTime} />);

      const srText = screen.getByText((_content, element) => {
        return element?.classList.contains('sr-only') || false;
      });

      expect(srText).toBeInTheDocument();
    });

    it('includes screen reader text for ended streams', () => {
      const endedTime = new Date('2024-12-31T22:00:00Z');
      render(<StreamStatusBadge status="ended" endedTime={endedTime} />);

      const srText = screen.getByText((_content, element) => {
        return element?.classList.contains('sr-only') || false;
      });

      expect(srText).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('defaults to offline for invalid status', () => {
      // @ts-expect-error Testing invalid status
      render(<StreamStatusBadge status="invalid" />);

      expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    });

    it('defaults to offline when status is undefined', () => {
      render(<StreamStatusBadge />);

      expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    });
  });
});

describe('StreamStatusBadge (RTL)', () => {
  describe('Arabic Labels', () => {
    it('renders Arabic label for live status', () => {
      render(<StreamStatusBadgeRTL status="live" />);

      expect(screen.getByText('مباشر')).toBeInTheDocument();
    });

    it('renders Arabic label for scheduled status', () => {
      render(<StreamStatusBadgeRTL status="scheduled" />);

      expect(screen.getByText('مجدول')).toBeInTheDocument();
    });

    it('renders Arabic label for ended status', () => {
      render(<StreamStatusBadgeRTL status="ended" />);

      expect(screen.getByText('انتهى')).toBeInTheDocument();
    });

    it('renders Arabic label for cancelled status', () => {
      render(<StreamStatusBadgeRTL status="cancelled" />);

      expect(screen.getByText('ملغى')).toBeInTheDocument();
    });

    it('renders Arabic label for offline status', () => {
      render(<StreamStatusBadgeRTL status="offline" />);

      expect(screen.getByText('غير متصل')).toBeInTheDocument();
    });
  });

  describe('RTL Layout', () => {
    it('applies RTL direction', () => {
      render(<StreamStatusBadgeRTL status="live" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveAttribute('dir', 'rtl');
    });

    it('applies flex-row-reverse for icon placement', () => {
      render(<StreamStatusBadgeRTL status="live" showIcon />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveClass('flex-row-reverse');
    });
  });

  describe('Accessibility (RTL)', () => {
    it('has Arabic aria-label', () => {
      render(<StreamStatusBadgeRTL status="live" />);
      const badge = screen.getByRole('status');

      expect(badge).toHaveAttribute('aria-label');
      expect(badge.getAttribute('aria-label')).toContain('حالة البث');
    });
  });
});
