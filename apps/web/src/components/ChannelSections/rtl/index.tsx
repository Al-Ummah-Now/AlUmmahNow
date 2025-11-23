'use client';

import { useEffect, useState } from 'react';
import { ChannelSection } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from '../ChannelSectionRenderer';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { logger } from '@/lib/logger-client';

interface ChannelSectionsProps {
  channelId: string;
}

export function ChannelSections({ channelId }: ChannelSectionsProps) {
  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    logger.info('ChannelSections RTL: Fetching sections', { channelId });

    async function fetchSections() {
      try {
        const result = await listChannelSectionsPopulated(channelId);

        logger.info('ChannelSections RTL: Sections loaded', {
          channelId,
          sectionsCount: result?.length || 0
        });

        if (result && Array.isArray(result)) {
          setSections(result);
        } else {
          logger.error('ChannelSections RTL: Failed to load sections', { channelId });
          setError('Failed to load channel sections');
        }
      } catch (err) {
        logger.error('ChannelSections RTL: Network error', { channelId, error: err });
        setError('Network error loading sections');
      } finally {
        setLoading(false);
      }
    }

    fetchSections();
  }, [channelId]);

  if (loading) {
    return <ChannelSectionsSkeleton />;
  }

  if (error) {
    logger.error('ChannelSections RTL: Error state', { error, channelId });
    return null;
  }

  if (sections.length === 0) {
    logger.info('ChannelSections RTL: No sections to display', { channelId });
    return null;
  }

  logger.info('ChannelSections RTL: Rendering sections', { channelId, sectionsCount: sections.length });

  return (
    <div className="space-y-8" dir="rtl">
      {sections.map((section) => (
        <ChannelSectionRenderer
          key={section.id}
          section={section}
          channelId={channelId}
        />
      ))}
    </div>
  );
}

function ChannelSectionsSkeleton() {
  return (
    <div className="space-y-8" dir="rtl">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4 mr-auto"></div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="flex-shrink-0 w-64 space-y-2">
                <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mr-auto"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mr-auto"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
