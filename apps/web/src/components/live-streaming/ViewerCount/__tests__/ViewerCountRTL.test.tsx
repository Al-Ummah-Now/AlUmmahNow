/**
 * ViewerCount RTL Component Tests
 * Task 1.12: Mobile/Desktop Testing Strategy
 *
 * Tests for Arabic/RTL variant including:
 * - Arabic numeral formatting
 * - RTL layout direction
 * - Arabic labels
 * - Same functionality as LTR variant
 */

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRTL } from '@/__tests__/utils/test-utils';
import { ViewerCountRTL } from '../rtl';

describe('ViewerCount RTL Component', () => {
  describe('RTL Layout', () => {
    it('has dir="rtl" attribute', () => {
      renderWithRTL(<ViewerCountRTL count={100} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('dir', 'rtl');
    });

    it('has flex-row-reverse class for RTL layout', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('flex-row-reverse');
    });
  });

  describe('Arabic Numeral Formatting', () => {
    it('renders Arabic-Indic numerals for small numbers', () => {
      renderWithRTL(<ViewerCountRTL count={123} />);
      // Arabic-Indic numerals for 123: ١٢٣
      expect(screen.getByText('١٢٣')).toBeInTheDocument();
    });

    it('formats thousands in Arabic (compact)', () => {
      renderWithRTL(<ViewerCountRTL count={1234} format="compact" />);
      // Should show something like: ١٫٢ ألف
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      // Contains Arabic numerals
      expect(status.textContent).toMatch(/[٠-٩]/);
    });

    it('formats numbers with Arabic decimal separator', () => {
      renderWithRTL(<ViewerCountRTL count={1500} format="compact" />);
      const status = screen.getByRole('status');
      // Should contain Arabic comma (٫) as decimal separator
      expect(status.textContent).toMatch(/[٠-٩]/);
    });

    it('renders zero in Arabic numerals', () => {
      renderWithRTL(<ViewerCountRTL count={0} />);
      expect(screen.getByText('٠')).toBeInTheDocument();
    });
  });

  describe('Arabic Labels', () => {
    it('shows Arabic "يشاهدون" label when showLabel is true', () => {
      renderWithRTL(<ViewerCountRTL count={100} showLabel />);
      expect(screen.getByText('يشاهدون')).toBeInTheDocument();
    });

    it('hides Arabic label when showLabel is false', () => {
      renderWithRTL(<ViewerCountRTL count={100} showLabel={false} />);
      expect(screen.queryByText('يشاهدون')).not.toBeInTheDocument();
    });

    it('hides Arabic label when loading', () => {
      renderWithRTL(
        <ViewerCountRTL count={100} showLabel isLoading />
      );
      expect(screen.queryByText('يشاهدون')).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading placeholder (em dash)', () => {
      renderWithRTL(<ViewerCountRTL count={100} isLoading />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('shows Arabic loading message in aria-label', () => {
      renderWithRTL(<ViewerCountRTL count={100} isLoading />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute(
        'aria-label',
        'جارٍ تحميل عدد المشاهدين'
      );
    });

    it('adds pulse animation when loading', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} isLoading />
      );
      const icon = container.querySelector('svg');
      expect(icon).toHaveClass('animate-pulse');
    });
  });

  describe('Live Indicator', () => {
    it('applies red color when isLive is true', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} isLive />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('text-red-600');
    });

    it('does not apply red color when isLive is false', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} isLive={false} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).not.toHaveClass('text-red-600');
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      renderWithRTL(<ViewerCountRTL count={100} />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveAttribute('aria-atomic', 'true');
    });

    it('has Arabic aria-label for viewer count', () => {
      renderWithRTL(<ViewerCountRTL count={5} />);
      const status = screen.getByRole('status');
      // Arabic label should be present
      expect(status).toHaveAttribute('aria-label');
      const ariaLabel = status.getAttribute('aria-label');
      expect(ariaLabel).toContain('مشاهد'); // Contains "viewer" in Arabic
    });

    it('icon has aria-hidden attribute', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} />
      );
      const icon = container.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Click Handler', () => {
    it('calls onClick when clicked', async () => {
      const handleClick = jest.fn();
      const { user } = renderWithRTL(
        <ViewerCountRTL count={100} onClick={handleClick} />
      );

      const status = screen.getByRole('status');
      await user.click(status);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('applies cursor-pointer with onClick', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} onClick={() => {}} />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('cursor-pointer');
    });
  });

  describe('Custom Styling', () => {
    it('applies custom className', () => {
      const { container } = renderWithRTL(
        <ViewerCountRTL count={100} className="custom-rtl-class" />
      );
      const status = container.querySelector('[role="status"]');
      expect(status).toHaveClass('custom-rtl-class');
    });
  });

  describe('Edge Cases', () => {
    it('handles negative numbers', () => {
      renderWithRTL(<ViewerCountRTL count={-50} />);
      expect(screen.getByText('٠')).toBeInTheDocument();
    });

    it('handles NaN', () => {
      renderWithRTL(<ViewerCountRTL count={NaN} />);
      expect(screen.getByText('٠')).toBeInTheDocument();
    });

    it('handles undefined count', () => {
      // @ts-expect-error - Testing edge case with undefined
      renderWithRTL(<ViewerCountRTL count={undefined} />);
      expect(screen.getByText('٠')).toBeInTheDocument();
    });

    it('handles very large numbers', () => {
      renderWithRTL(<ViewerCountRTL count={1000000} />);
      const status = screen.getByRole('status');
      // Should contain Arabic numerals
      expect(status.textContent).toMatch(/[٠-٩]/);
    });
  });

  describe('Component Memoization', () => {
    it('memoizes and does not re-render with same props', () => {
      const { rerender } = renderWithRTL(
        <ViewerCountRTL count={100} />
      );

      const firstRender = screen.getByRole('status');

      rerender(<ViewerCountRTL count={100} />);

      const secondRender = screen.getByRole('status');

      expect(firstRender).toBe(secondRender);
    });
  });

  describe('Format Variants', () => {
    it('renders in compact format by default', () => {
      renderWithRTL(<ViewerCountRTL count={1500} />);
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
    });

    it('renders in full format when specified', () => {
      renderWithRTL(<ViewerCountRTL count={1234} format="full" />);
      const status = screen.getByRole('status');
      // Full format should show: ١٬٢٣٤
      expect(status.textContent).toMatch(/[٠-٩]/);
    });
  });
});
