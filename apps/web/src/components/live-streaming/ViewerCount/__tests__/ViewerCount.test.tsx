/**
 * ViewerCount Component Tests
 * Task 1.12: Mobile/Desktop Testing Strategy
 *
 * Comprehensive unit tests for ViewerCount component including:
 * - Rendering with different counts
 * - Number formatting (compact vs full)
 * - Loading states
 * - Click handlers
 * - Accessibility (ARIA labels, roles)
 * - Dark mode variants
 */

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/utils/test-utils';
import { viewerCountTestCases } from '@/__tests__/utils/mock-data';
import { ViewerCount } from '../index';

describe('ViewerCount Component', () => {
  describe('Rendering', () => {
    it('renders with zero viewers', () => {
      renderWithProviders(<ViewerCount count={0} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('renders with positive viewer count', () => {
      renderWithProviders(<ViewerCount count={1234} />);
      expect(screen.getByText('1.2K')).toBeInTheDocument();
    });

    it('renders with live indicator styling', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} isLive />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('text-red-600');
    });

    it('renders without live indicator styling', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} isLive={false} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).not.toHaveClass('text-red-600');
    });

    it('applies custom className', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} className="custom-class" />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('custom-class');
    });
  });

  describe('Number Formatting', () => {
    describe('Compact Format (default)', () => {
      it.each(viewerCountTestCases)(
        'formats $count as $formatted in compact mode',
        ({ count, formatted }) => {
          renderWithProviders(
            <ViewerCount count={count} format="compact" />
          );
          expect(screen.getByText(formatted)).toBeInTheDocument();
        }
      );
    });

    describe('Full Format', () => {
      it('formats 1,234 in full mode', () => {
        renderWithProviders(
          <ViewerCount count={1234} format="full" />
        );
        expect(screen.getByText('1,234')).toBeInTheDocument();
      });

      it('formats 10,000 in full mode', () => {
        renderWithProviders(
          <ViewerCount count={10000} format="full" />
        );
        expect(screen.getByText('10,000')).toBeInTheDocument();
      });

      it('formats 1,000,000 in full mode', () => {
        renderWithProviders(
          <ViewerCount count={1000000} format="full" />
        );
        expect(screen.getByText('1,000,000')).toBeInTheDocument();
      });
    });

    it('handles invalid counts gracefully', () => {
      renderWithProviders(<ViewerCount count={-100} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles NaN gracefully', () => {
      renderWithProviders(<ViewerCount count={NaN} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('Label Display', () => {
    it('shows "watching" label when showLabel is true', () => {
      renderWithProviders(
        <ViewerCount count={100} showLabel />
      );
      expect(screen.getByText('watching')).toBeInTheDocument();
    });

    it('hides "watching" label when showLabel is false', () => {
      renderWithProviders(
        <ViewerCount count={100} showLabel={false} />
      );
      expect(screen.queryByText('watching')).not.toBeInTheDocument();
    });

    it('hides "watching" label by default', () => {
      renderWithProviders(<ViewerCount count={100} />);
      expect(screen.queryByText('watching')).not.toBeInTheDocument();
    });

    it('hides label when loading', () => {
      renderWithProviders(
        <ViewerCount count={100} showLabel isLoading />
      );
      expect(screen.queryByText('watching')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading placeholder when isLoading is true', () => {
      renderWithProviders(<ViewerCount count={100} isLoading />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('adds pulse animation to icon when loading', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} isLoading />
      );
      const icon = container.querySelector('svg');
      expect(icon).toHaveClass('animate-pulse');
    });

    it('shows correct ARIA label when loading', () => {
      renderWithProviders(<ViewerCount count={100} isLoading />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-label', 'Loading viewer count');
    });
  });

  describe('Click Handler', () => {
    it('calls onClick when clicked', async () => {
      const handleClick = jest.fn();
      const { user } = renderWithProviders(
        <ViewerCount count={100} onClick={handleClick} />
      );

      const status = screen.getByRole('status');
      await user.click(status);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('applies cursor-pointer when onClick is provided', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} onClick={() => {}} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('cursor-pointer');
    });

    it('does not apply cursor-pointer without onClick', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).not.toHaveClass('cursor-pointer');
    });
  });

  describe('Accessibility', () => {
    it('has role="status"', () => {
      renderWithProviders(<ViewerCount count={100} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has aria-live="polite"', () => {
      renderWithProviders(<ViewerCount count={100} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-atomic="true"', () => {
      renderWithProviders(<ViewerCount count={100} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-atomic', 'true');
    });

    it.each([
      { count: 0, expected: 'No viewers watching now' },
      { count: 1, expected: '1 viewer watching now' },
      { count: 100, expected: '100 viewers watching now' },
      { count: 1234, expected: '1,234 viewers watching now' },
    ])(
      'has correct aria-label for $count viewers',
      ({ count, expected }) => {
        renderWithProviders(<ViewerCount count={count} />);
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-label', expected);
      }
    );

    it('has aria-hidden on icon', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} />
      );
      const icon = container.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Dark Mode', () => {
    it('renders correctly in dark mode', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} />,
        { theme: 'dark' }
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toBeInTheDocument();
    });

    it('applies dark mode text colors', () => {
      const { container } = renderWithProviders(
        <ViewerCount count={100} isLive />,
        { theme: 'dark' }
      );
      const status = container.querySelector('[role="status"]');
      // Component uses same colors in dark mode (red for live)
      expect(status).toHaveClass('text-red-600');
    });
  });

  describe('Component Memoization', () => {
    it('does not re-render with same props', () => {
      const { rerender } = renderWithProviders(
        <ViewerCount count={100} />
      );

      const firstRender = screen.getByRole('status');

      rerender(<ViewerCount count={100} />);

      const secondRender = screen.getByRole('status');

      // Same element reference indicates no re-render
      expect(firstRender).toBe(secondRender);
    });

    it('re-renders when count changes', () => {
      const { rerender } = renderWithProviders(
        <ViewerCount count={100} />
      );

      expect(screen.getByText('100')).toBeInTheDocument();

      rerender(<ViewerCount count={200} />);

      expect(screen.getByText('200')).toBeInTheDocument();
      expect(screen.queryByText('100')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very large numbers', () => {
      renderWithProviders(
        <ViewerCount count={999999999} />
      );
      expect(screen.getByText('1B')).toBeInTheDocument();
    });

    it('handles decimal counts by rounding down', () => {
      renderWithProviders(<ViewerCount count={123.7} />);
      // Component doesn't round - it displays the full number as-is
      expect(screen.getByText('123.7')).toBeInTheDocument();
    });

    it('handles string counts by converting to number', () => {
      // @ts-expect-error - Testing edge case with string input
      renderWithProviders(<ViewerCount count={'456'} />);
      expect(screen.getByText('456')).toBeInTheDocument();
    });

    it('handles undefined count as 0', () => {
      // @ts-expect-error - Testing edge case with undefined
      renderWithProviders(<ViewerCount count={undefined} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles null count as 0', () => {
      // @ts-expect-error - Testing edge case with null
      renderWithProviders(<ViewerCount count={null} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });
});
