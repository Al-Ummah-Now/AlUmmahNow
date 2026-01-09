/**
 * Time Components for Calendar
 *
 * Custom time components for localizing time display in day/week views
 */

'use client';

import React from 'react';

/**
 * Custom Time Gutter Header - Shows localized hours in the left gutter
 * Note: This is just a placeholder component, time gutter doesn't actually use custom headers
 */
export const TimeGutterHeader: React.FC = () => {
  return null;
};

/**
 * Custom Time Slot Wrapper - Shows localized time labels for each slot
 */
interface TimeSlotWrapperProps {
  value: Date;
  resource?: unknown;
  children?: React.ReactNode;
}

export const TimeSlotWrapper: React.FC<TimeSlotWrapperProps> = ({ children }) => {
  return <div className="rbc-time-slot">{children}</div>;
};
