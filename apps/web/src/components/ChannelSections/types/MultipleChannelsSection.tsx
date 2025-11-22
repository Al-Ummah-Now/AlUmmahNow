'use client';

import { SectionHeader } from '../SectionHeader';
import { logger } from '@/lib/logger-client';

interface MultipleChannelsSectionProps {
  title: string;
  channelIds: string[];
}

export function MultipleChannelsSection({ title, channelIds }: MultipleChannelsSectionProps) {
  logger.info('MultipleChannelsSection: Rendering placeholder', { title, channelIds });

  return (
    <section className="space-y-4">
      <SectionHeader title={title} />
      <div className="p-8 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Featured channels section coming soon
        </p>
      </div>
    </section>
  );
}
