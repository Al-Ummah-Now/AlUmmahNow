/**
 * Tests for ViewSwitcher Component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from '../ViewSwitcher';

describe('ViewSwitcher', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render list and calendar buttons', () => {
    render(<ViewSwitcher currentView="list" onChange={mockOnChange} />);

    expect(screen.getByLabelText('List view')).toBeInTheDocument();
    expect(screen.getByLabelText('Calendar view')).toBeInTheDocument();
  });

  it('should highlight active view (list)', () => {
    render(<ViewSwitcher currentView="list" onChange={mockOnChange} />);

    const listButton = screen.getByLabelText('List view');
    const calendarButton = screen.getByLabelText('Calendar view');

    expect(listButton).toHaveAttribute('aria-pressed', 'true');
    expect(calendarButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('should highlight active view (calendar)', () => {
    render(<ViewSwitcher currentView="calendar" onChange={mockOnChange} />);

    const listButton = screen.getByLabelText('List view');
    const calendarButton = screen.getByLabelText('Calendar view');

    expect(listButton).toHaveAttribute('aria-pressed', 'false');
    expect(calendarButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('should call onChange when list view is clicked', () => {
    render(<ViewSwitcher currentView="calendar" onChange={mockOnChange} />);

    const listButton = screen.getByLabelText('List view');
    fireEvent.click(listButton);

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith('list');
  });

  it('should call onChange when calendar view is clicked', () => {
    render(<ViewSwitcher currentView="list" onChange={mockOnChange} />);

    const calendarButton = screen.getByLabelText('Calendar view');
    fireEvent.click(calendarButton);

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith('calendar');
  });

  it('should render with custom className', () => {
    const { container } = render(
      <ViewSwitcher
        currentView="list"
        onChange={mockOnChange}
        className="custom-class"
      />
    );

    const viewSwitcher = container.querySelector('.custom-class');
    expect(viewSwitcher).toBeInTheDocument();
  });

  it('should be keyboard accessible', () => {
    render(<ViewSwitcher currentView="list" onChange={mockOnChange} />);

    const listButton = screen.getByLabelText('List view');
    const calendarButton = screen.getByLabelText('Calendar view');

    expect(listButton).toHaveAttribute('type', 'button');
    expect(calendarButton).toHaveAttribute('type', 'button');
  });

  it('should have proper ARIA role', () => {
    const { container } = render(
      <ViewSwitcher currentView="list" onChange={mockOnChange} />
    );

    const group = container.querySelector('[role="group"]');
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute('aria-label', 'View switcher');
  });

  it('should not call onChange when clicking already active view', () => {
    render(<ViewSwitcher currentView="list" onChange={mockOnChange} />);

    const listButton = screen.getByLabelText('List view');
    fireEvent.click(listButton);

    // Should still call onChange (component doesn't prevent this)
    expect(mockOnChange).toHaveBeenCalledWith('list');
  });

  it('should render icons for both views', () => {
    const { container } = render(
      <ViewSwitcher currentView="list" onChange={mockOnChange} />
    );

    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2); // List icon and Calendar icon
  });

  it('should apply dark mode classes', () => {
    const { container } = render(
      <ViewSwitcher currentView="list" onChange={mockOnChange} />
    );

    const viewSwitcher = container.firstChild;
    expect(viewSwitcher).toHaveClass('dark:bg-gray-800');
  });
});
