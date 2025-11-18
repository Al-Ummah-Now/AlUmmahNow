'use client';

import { SectionHeader } from '../SectionHeader';

interface UpcomingEventsSectionProps {
  channelId: string;
}

export function UpcomingEventsSection({ channelId }: UpcomingEventsSectionProps) {
  console.log('[UpcomingEventsSection] Placeholder for channel:', channelId);

  return (
    <section className="space-y-4">
      <SectionHeader title="Upcoming live streams" />
      <div className="p-8 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Upcoming live streams section coming soon
        </p>
      </div>
    </section>
  );
}
