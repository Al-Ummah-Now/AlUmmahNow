/**
 * Tests for CalendarControls Component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarControls } from '../CalendarControls';

describe('CalendarControls', () => {
  const mockOnTimeSpanChange = jest.fn();
  const mockOnCalendarTypeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Time Span Controls', () => {
    it('should render month, week, and day buttons', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      expect(screen.getByLabelText('Month view')).toBeInTheDocument();
      expect(screen.getByLabelText('Week view')).toBeInTheDocument();
      expect(screen.getByLabelText('Day view')).toBeInTheDocument();
    });

    it('should highlight active time span', () => {
      render(
        <CalendarControls
          timeSpan="week"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      expect(screen.getByLabelText('Week view')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Month view')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      expect(screen.getByLabelText('Day view')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('should call onTimeSpanChange when month is clicked', () => {
      render(
        <CalendarControls
          timeSpan="week"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText('Month view'));

      expect(mockOnTimeSpanChange).toHaveBeenCalledTimes(1);
      expect(mockOnTimeSpanChange).toHaveBeenCalledWith('month');
    });

    it('should call onTimeSpanChange when week is clicked', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText('Week view'));

      expect(mockOnTimeSpanChange).toHaveBeenCalledTimes(1);
      expect(mockOnTimeSpanChange).toHaveBeenCalledWith('week');
    });

    it('should call onTimeSpanChange when day is clicked', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText('Day view'));

      expect(mockOnTimeSpanChange).toHaveBeenCalledTimes(1);
      expect(mockOnTimeSpanChange).toHaveBeenCalledWith('day');
    });
  });

  describe('Calendar Type Controls', () => {
    it('should render Gregorian and Hijri buttons', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      expect(screen.getByLabelText('Gregorian calendar')).toBeInTheDocument();
      expect(screen.getByLabelText('Hijri calendar')).toBeInTheDocument();
    });

    it('should highlight active calendar type', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="hijri"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      expect(screen.getByLabelText('Hijri calendar')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Gregorian calendar')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('should call onCalendarTypeChange when Gregorian is clicked', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="hijri"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText('Gregorian calendar'));

      expect(mockOnCalendarTypeChange).toHaveBeenCalledTimes(1);
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('gregorian');
    });

    it('should call onCalendarTypeChange when Hijri is clicked', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      fireEvent.click(screen.getByLabelText('Hijri calendar'));

      expect(mockOnCalendarTypeChange).toHaveBeenCalledTimes(1);
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('hijri');
    });
  });

  describe('Localization', () => {
    it('should translate labels based on locale (English)', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
          locale="en"
        />
      );

      expect(screen.getByText('Month')).toBeInTheDocument();
      expect(screen.getByText('Week')).toBeInTheDocument();
      expect(screen.getByText('Day')).toBeInTheDocument();
      expect(screen.getByText('Gregorian')).toBeInTheDocument();
      expect(screen.getByText('Hijri')).toBeInTheDocument();
    });

    it('should translate labels based on locale (Arabic)', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
          locale="ar"
        />
      );

      expect(screen.getByText('شهر')).toBeInTheDocument();
      expect(screen.getByText('أسبوع')).toBeInTheDocument();
      expect(screen.getByText('يوم')).toBeInTheDocument();
      expect(screen.getByText('ميلادي')).toBeInTheDocument();
      expect(screen.getByText('هجري')).toBeInTheDocument();
    });

    it('should apply RTL layout for Arabic locale', () => {
      const { container } = render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
          locale="ar"
        />
      );

      const mainDiv = container.firstChild;
      expect(mainDiv).toHaveAttribute('dir', 'rtl');
    });

    it('should apply LTR layout for English locale', () => {
      const { container } = render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
          locale="en"
        />
      );

      const mainDiv = container.firstChild;
      expect(mainDiv).toHaveAttribute('dir', 'ltr');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA roles for time span', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      const timeSpanGroup = screen.getByLabelText('Time span selector');
      expect(timeSpanGroup).toBeInTheDocument();
      expect(timeSpanGroup).toHaveAttribute('role', 'group');
    });

    it('should have proper ARIA roles for calendar type', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      const calendarTypeGroup = screen.getByLabelText('Calendar type selector');
      expect(calendarTypeGroup).toBeInTheDocument();
      expect(calendarTypeGroup).toHaveAttribute('role', 'group');
    });

    it('should be keyboard accessible', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('type', 'button');
      });
    });
  });

  describe('Styling', () => {
    it('should render with custom className', () => {
      const { container } = render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
          className="custom-class"
        />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should apply dark mode classes', () => {
      render(
        <CalendarControls
          timeSpan="month"
          calendarType="gregorian"
          onTimeSpanChange={mockOnTimeSpanChange}
          onCalendarTypeChange={mockOnCalendarTypeChange}
        />
      );

      const inactiveButton = screen.getByLabelText('Week view');
      expect(inactiveButton).toHaveClass('dark:bg-gray-800');
    });
  });
});
