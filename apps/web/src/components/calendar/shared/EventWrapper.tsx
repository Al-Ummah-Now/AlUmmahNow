/**
 * EventWrapper Component
 *
 * Wraps CalendarEvent for use in react-big-calendar
 */

'use client';

import React from 'react';
import { CalendarEvent } from '../../scheduled-videos/CalendarEvent';
import type { VideoObject } from '@/interfaces';
import type { ScheduledPublishStatus } from '@al-ummah/shared-types';

export interface CalendarEventData {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: VideoObject;
}

interface EventWrapperProps {
  event: CalendarEventData;
  onClick: (videoId: string) => void;
  locale: 'en' | 'ar';
}

export const EventWrapper: React.FC<EventWrapperProps> = ({ event, onClick, locale }) => {
  // Extract status from the video resource
  const status = (event.resource as VideoObject & { scheduledPublishStatus?: ScheduledPublishStatus }).scheduledPublishStatus || 'scheduled';

  return (
    <CalendarEvent
      id={event.id}
      title={event.title}
      thumbnailUrl={event.resource.thumbnailUrl}
      scheduledDate={event.start}
      status={status}
      onClick={onClick}
      locale={locale}
      className="h-full"
    />
  );
};

/**
 * react-big-calendar `eventWrapper` for month and all-day rows.
 *
 * react-big-calendar marks each week's `.rbc-row-content` as role="row", but
 * renders the events inside it as plain divs, so our role="button" event
 * becomes a direct child of the row, which ARIA does not allow (a row owns
 * cells; axe aria-required-children). Giving the event's `.rbc-event` box the
 * gridcell role makes the tree valid: row > gridcell > button. Time-grid
 * events (type "time") sit outside any row and are left alone.
 */
export const RowEventWrapper: React.FC<{ type?: 'date' | 'time'; children?: React.ReactNode }> = ({ type, children }) => {
  if (type !== 'date' || !React.isValidElement<{ role?: string }>(children)) return <>{children}</>;
  return React.cloneElement(children, { role: 'gridcell' });
};
