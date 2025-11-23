/**
 * ScheduledVideoCalendar Component (RTL)
 *
 * RTL variant for Arabic locale with right-to-left layout support.
 */

'use client';

import React from 'react';
import { ScheduledVideoCalendar as LTRScheduledVideoCalendar } from '../index';
import type { ScheduledVideoCalendarProps } from '../index';

/**
 * RTL wrapper for ScheduledVideoCalendar
 * Applies RTL-specific styling and layout adjustments
 */
export function ScheduledVideoCalendar(props: ScheduledVideoCalendarProps) {
  return (
    <div dir="rtl" className="rtl-calendar-wrapper">
      <LTRScheduledVideoCalendar {...props} />

      {/* RTL-specific styles */}
      <style jsx global>{`
        .rtl-calendar-wrapper .rbc-header {
          text-align: right;
        }

        .rtl-calendar-wrapper .rbc-date-cell {
          text-align: right;
          padding-right: 8px;
        }

        .rtl-calendar-wrapper .rbc-time-header-content {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-time-slot {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-day-slot .rbc-events-container {
          direction: rtl;
        }

        /* Mirror navigation buttons (handled by CalendarControls RTL variant) */
        .rtl-calendar-wrapper .rbc-toolbar button {
          direction: rtl;
        }

        /* Adjust event positioning for RTL */
        .rtl-calendar-wrapper .rbc-event {
          text-align: right;
        }

        /* Month view adjustments */
        .rtl-calendar-wrapper .rbc-month-view {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-month-header {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-month-row {
          direction: rtl;
        }

        /* Week/Day view adjustments */
        .rtl-calendar-wrapper .rbc-time-view {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-time-header {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-time-content {
          direction: rtl;
        }

        .rtl-calendar-wrapper .rbc-timeslot-group {
          direction: rtl;
        }

        /* Gutter positioning */
        .rtl-calendar-wrapper .rbc-time-gutter {
          text-align: left;
        }

        /* Event label positioning */
        .rtl-calendar-wrapper .rbc-event-label {
          text-align: right;
        }

        /* Popup positioning */
        .rtl-calendar-wrapper .rbc-overlay {
          direction: rtl;
        }

        /* Header cell alignment */
        .rtl-calendar-wrapper .rbc-header + .rbc-header {
          border-right: 1px solid rgb(229, 231, 235);
          border-left: none;
        }

        .dark .rtl-calendar-wrapper .rbc-header + .rbc-header {
          border-right-color: rgb(55, 65, 81);
        }

        /* Day cell borders */
        .rtl-calendar-wrapper .rbc-day-bg + .rbc-day-bg {
          border-right: 1px solid rgb(229, 231, 235);
          border-left: none;
        }

        .dark .rtl-calendar-wrapper .rbc-day-bg + .rbc-day-bg {
          border-right-color: rgb(55, 65, 81);
        }

        /* Time header content */
        .rtl-calendar-wrapper .rbc-time-header-content {
          border-right: 1px solid rgb(229, 231, 235);
          border-left: none;
        }

        .dark .rtl-calendar-wrapper .rbc-time-header-content {
          border-right-color: rgb(55, 65, 81);
        }

        /* Today highlight */
        .rtl-calendar-wrapper .rbc-today {
          background-color: rgba(59, 130, 246, 0.1);
        }
      `}</style>
    </div>
  );
}
