'use client';

import { SectionHeader } from '../SectionHeader';
import { logger } from '@/lib/logger-client';

interface LiveEventsSectionProps {
  channelId: string;
}

export function LiveEventsSection({ channelId }: LiveEventsSectionProps) {
  logger.info('LiveEventsSection: Rendering placeholder', { channelId });

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
