"use client";

import React from 'react';
import { ScheduleDateTimeSelector as BaseScheduleDateTimeSelector } from '../ScheduleDateTimeSelector';
import type { ScheduleData } from '../ScheduleDateTimeSelector';

interface ScheduleDateTimeSelectorRTLProps {
  onScheduleChange: (schedule: ScheduleData | null) => void;
  disabled?: boolean;
  initialSchedule?: ScheduleData;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
}

export const ScheduleDateTimeSelector: React.FC<ScheduleDateTimeSelectorRTLProps> = (props) => {
  return (
    <div dir="rtl">
      <BaseScheduleDateTimeSelector {...props} />
    </div>
  );
};
