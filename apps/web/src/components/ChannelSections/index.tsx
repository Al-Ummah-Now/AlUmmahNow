'use client';

import { useEffect, useState } from 'react';
import { ChannelSection } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';
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
    logger.info('ChannelSections: Fetching sections', { channelId });

    async function fetchSections() {
      try {
        const sections = await listChannelSectionsPopulated(channelId);

        logger.info('ChannelSections: Sections loaded', {
          channelId,
          sectionsCount: sections?.length || 0
        });

        if (sections && sections.length >= 0) {
          setSections(sections);
        } else {
          logger.error('ChannelSections: Failed to load sections', { channelId });
          setError('Failed to load channel sections');
        }
      } catch (err) {
        logger.error('ChannelSections: Network error', { channelId, error: err });
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
    logger.error('ChannelSections: Error state', { error, channelId });
    return null; // Fail silently on channel pages
  }

  if (sections.length === 0) {
    logger.info('ChannelSections: No sections to display', { channelId });
    return null;
  }

  logger.info('ChannelSections: Rendering sections', { channelId, sectionsCount: sections.length });

  return (
    <div className="space-y-8">
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
    <div className="space-y-8">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4"></div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="flex-shrink-0 w-64 space-y-2">
                <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
