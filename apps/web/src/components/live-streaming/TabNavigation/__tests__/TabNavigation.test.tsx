/**
 * TabNavigation Component Tests
 * Task 1.12: Mobile/Desktop Testing Strategy
 *
 * Comprehensive tests for TabNavigation including:
 * - Tab rendering and selection
 * - Keyboard navigation (Arrow keys, Home, End)
 * - Click interactions
 * - ARIA attributes and accessibility
 * - Count badges
 * - Dark mode
 */

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/utils/test-utils';
import { TabNavigation } from '../index';
import type { TabConfig } from '../types';

describe('TabNavigation Component', () => {
  const mockTabs: TabConfig[] = [
    { value: 'live', label: 'Live Now', count: 5 },
    { value: 'scheduled', label: 'Scheduled', count: 12 },
    { value: 'ended', label: 'Past Streams', count: 30 },
  ];

  describe('Rendering', () => {
    it('renders all tabs', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      expect(screen.getByRole('tab', { name: /Live Now/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Scheduled/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Past Streams/i })).toBeInTheDocument();
    });

    it('has proper tablist role', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('uses default tabs when none provided', () => {
      renderWithProviders(
        <TabNavigation activeTab="live" onTabChange={() => {}} />
      );

      expect(screen.getByRole('tab', { name: /Live Now/i })).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
          className="custom-tabs"
        />
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveClass('custom-tabs');
    });
  });

  describe('Active Tab', () => {
    it('marks active tab with aria-selected=true', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="scheduled"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const activeTab = screen.getByRole('tab', { name: /Scheduled/i });
      expect(activeTab).toHaveAttribute('aria-selected', 'true');
    });

    it('marks inactive tabs with aria-selected=false', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const inactiveTab = screen.getByRole('tab', { name: /Scheduled/i });
      expect(inactiveTab).toHaveAttribute('aria-selected', 'false');
    });

    it('applies active styling to selected tab', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const activeTab = screen.getByRole('tab', { name: /Live Now/i });
      expect(activeTab).toHaveClass('border-primary', 'text-primary');
    });

    it('sets tabIndex=0 for active tab', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const activeTab = screen.getByRole('tab', { name: /Live Now/i });
      expect(activeTab).toHaveAttribute('tabindex', '0');
    });

    it('sets tabIndex=-1 for inactive tabs', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const inactiveTab = screen.getByRole('tab', { name: /Scheduled/i });
      expect(inactiveTab).toHaveAttribute('tabindex', '-1');
    });
  });

  describe('Click Interactions', () => {
    it('calls onTabChange when tab is clicked', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const scheduledTab = screen.getByRole('tab', { name: /Scheduled/i });
      await user.click(scheduledTab);

      expect(handleChange).toHaveBeenCalledWith('scheduled');
    });

    it('calls onTabChange with correct value for each tab', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      await user.click(screen.getByRole('tab', { name: /Live Now/i }));
      expect(handleChange).toHaveBeenLastCalledWith('live');

      await user.click(screen.getByRole('tab', { name: /Scheduled/i }));
      expect(handleChange).toHaveBeenLastCalledWith('scheduled');

      await user.click(screen.getByRole('tab', { name: /Past Streams/i }));
      expect(handleChange).toHaveBeenLastCalledWith('ended');
    });
  });

  describe('Keyboard Navigation', () => {
    it('moves focus to next tab with ArrowRight', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const liveTab = screen.getByRole('tab', { name: /Live Now/i });
      liveTab.focus();

      await user.keyboard('{ArrowRight}');

      expect(handleChange).toHaveBeenCalledWith('scheduled');
      expect(screen.getByRole('tab', { name: /Scheduled/i })).toHaveFocus();
    });

    it('moves focus to previous tab with ArrowLeft', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="scheduled"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const scheduledTab = screen.getByRole('tab', { name: /Scheduled/i });
      scheduledTab.focus();

      await user.keyboard('{ArrowLeft}');

      expect(handleChange).toHaveBeenCalledWith('live');
      expect(screen.getByRole('tab', { name: /Live Now/i })).toHaveFocus();
    });

    it('wraps to last tab when pressing ArrowLeft on first tab', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const liveTab = screen.getByRole('tab', { name: /Live Now/i });
      liveTab.focus();

      await user.keyboard('{ArrowLeft}');

      expect(handleChange).toHaveBeenCalledWith('ended');
      expect(screen.getByRole('tab', { name: /Past Streams/i })).toHaveFocus();
    });

    it('wraps to first tab when pressing ArrowRight on last tab', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="ended"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const endedTab = screen.getByRole('tab', { name: /Past Streams/i });
      endedTab.focus();

      await user.keyboard('{ArrowRight}');

      expect(handleChange).toHaveBeenCalledWith('live');
      expect(screen.getByRole('tab', { name: /Live Now/i })).toHaveFocus();
    });

    it('moves to first tab with Home key', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="ended"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const endedTab = screen.getByRole('tab', { name: /Past Streams/i });
      endedTab.focus();

      await user.keyboard('{Home}');

      expect(handleChange).toHaveBeenCalledWith('live');
      expect(screen.getByRole('tab', { name: /Live Now/i })).toHaveFocus();
    });

    it('moves to last tab with End key', async () => {
      const handleChange = jest.fn();
      const { user } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const liveTab = screen.getByRole('tab', { name: /Live Now/i });
      liveTab.focus();

      await user.keyboard('{End}');

      expect(handleChange).toHaveBeenCalledWith('ended');
      expect(screen.getByRole('tab', { name: /Past Streams/i })).toHaveFocus();
    });
  });

  describe('Count Badges', () => {
    it('shows count badges when showCounts is true', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
          showCounts
        />
      );

      expect(screen.getByText('5')).toBeInTheDocument(); // Live count
      expect(screen.getByText('12')).toBeInTheDocument(); // Scheduled count
      expect(screen.getByText('30')).toBeInTheDocument(); // Ended count
    });

    it('hides count badges when showCounts is false', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
          showCounts={false}
        />
      );

      expect(screen.queryByText('5')).not.toBeInTheDocument();
      expect(screen.queryByText('12')).not.toBeInTheDocument();
      expect(screen.queryByText('30')).not.toBeInTheDocument();
    });

    it('applies active styling to count badge on active tab', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
          showCounts
        />
      );

      const activeTab = screen.getByRole('tab', { name: /Live Now/i });
      const badge = activeTab.querySelector('span:last-child');

      expect(badge).toHaveClass('bg-primary/10', 'text-primary');
    });

    it('has aria-label for count badges', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
          showCounts
        />
      );

      const liveTab = screen.getByRole('tab', { name: /Live Now/i });
      const badge = liveTab.querySelector('[aria-label]');

      expect(badge).toHaveAttribute('aria-label', '5 live now');
    });
  });

  describe('Icons', () => {
    it('renders tab icons when provided', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      // Check for lucide-react icons
      const icons = container.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('hides icons from screen readers with aria-hidden', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const icons = container.querySelectorAll('svg');
      icons.forEach((icon) => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  describe('Accessibility', () => {
    it('has aria-label on tablist', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('aria-label', 'Stream filters');
    });

    it('has aria-controls linking tab to panel', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const liveTab = screen.getByRole('tab', { name: /Live Now/i });
      expect(liveTab).toHaveAttribute('aria-controls', 'live-panel');
    });

    it('has unique ID for each tab', () => {
      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      expect(screen.getByRole('tab', { name: /Live Now/i }))
        .toHaveAttribute('id', 'live-tab');
      expect(screen.getByRole('tab', { name: /Scheduled/i }))
        .toHaveAttribute('id', 'scheduled-tab');
      expect(screen.getByRole('tab', { name: /Past Streams/i }))
        .toHaveAttribute('id', 'ended-tab');
    });

    it('has visible focus indicators', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      tabs.forEach((tab) => {
        expect(tab).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-primary');
      });
    });
  });

  describe('Dark Mode', () => {
    it('renders correctly in dark mode', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />,
        { theme: 'dark' }
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveClass('dark:border-gray-700');
    });
  });

  describe('Responsive Behavior', () => {
    it('has horizontal scroll on mobile', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toHaveClass('overflow-x-auto');
    });

    it('prevents text wrapping with whitespace-nowrap', () => {
      const { container } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={mockTabs}
        />
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      tabs.forEach((tab) => {
        expect(tab).toHaveClass('whitespace-nowrap');
      });
    });
  });

  describe('Component Memoization', () => {
    it('does not re-render with same props', () => {
      const handleChange = jest.fn();
      const { rerender } = renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const firstRender = screen.getByRole('tablist');

      rerender(
        <TabNavigation
          activeTab="live"
          onTabChange={handleChange}
          tabs={mockTabs}
        />
      );

      const secondRender = screen.getByRole('tablist');

      expect(firstRender).toBe(secondRender);
    });
  });

  describe('Edge Cases', () => {
    it('handles single tab', () => {
      const singleTab: TabConfig[] = [
        { value: 'live', label: 'Live Now' },
      ];

      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={singleTab}
        />
      );

      expect(screen.getByRole('tab', { name: /Live Now/i })).toBeInTheDocument();
    });

    it('handles tabs without counts', () => {
      const tabsWithoutCounts: TabConfig[] = [
        { value: 'live', label: 'Live Now' },
        { value: 'scheduled', label: 'Scheduled' },
      ];

      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={tabsWithoutCounts}
          showCounts
        />
      );

      expect(screen.getByRole('tab', { name: /Live Now/i })).toBeInTheDocument();
    });

    it('handles very long tab labels', () => {
      const tabsWithLongLabels: TabConfig[] = [
        { value: 'live', label: 'This is a very long tab label that might overflow' },
      ];

      renderWithProviders(
        <TabNavigation
          activeTab="live"
          onTabChange={() => {}}
          tabs={tabsWithLongLabels}
        />
      );

      expect(screen.getByRole('tab')).toBeInTheDocument();
    });
  });
});
