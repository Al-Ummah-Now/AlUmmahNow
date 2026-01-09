'use client';

import { SectionHeader } from '../SectionHeader';
import { logger } from '@/lib/logger-client';

interface SubscriptionsSectionProps {
  channelId: string;
}

export function SubscriptionsSection({ channelId }: SubscriptionsSectionProps) {
  logger.info('SubscriptionsSection: Rendering placeholder', { channelId });

  return (
    <section className="space-y-4">
      <SectionHeader title="Subscriptions" />
      <div className="p-8 bg-gray-50 dark:bg-gray-800 rounded-lg text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Subscriptions section coming soon
        </p>
      </div>
    </section>
  );
}
