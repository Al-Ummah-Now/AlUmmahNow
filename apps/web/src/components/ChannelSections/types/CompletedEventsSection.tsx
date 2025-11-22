'use client';

import { SectionHeader } from '../SectionHeader';
import { logger } from '@/lib/logger-client';

interface CompletedEventsSectionProps {
  channelId: string;
}

export function CompletedEventsSection({ channelId }: CompletedEventsSectionProps) {
  logger.info('CompletedEventsSection: Rendering placeholder', { channelId });

  return (
    <section className="space-y-4">
      <SectionHeader title="Past live streams" />
      <div className="p-8 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Past live streams section coming soon
        </p>
      </div>
    </section>
  );
}
