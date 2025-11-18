'use client';

import { SectionHeader } from '../SectionHeader';

interface LiveEventsSectionProps {
  channelId: string;
}

export function LiveEventsSection({ channelId }: LiveEventsSectionProps) {
  console.log('[LiveEventsSection] Placeholder for channel:', channelId);

  return (
    <section className="space-y-4">
      <SectionHeader title="Live now" />
      <div className="p-8 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Live streams section coming soon
        </p>
      </div>
    </section>
  );
}
