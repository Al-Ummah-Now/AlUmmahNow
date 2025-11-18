'use client';

import { useEffect, useState } from 'react';
import { ChannelSection } from '@al-ummah/shared-types';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';

interface ChannelSectionsProps {
  channelId: string;
}

export function ChannelSections({ channelId }: ChannelSectionsProps) {
  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[ChannelSections] Fetching sections for channel:', channelId);

    async function fetchSections() {
      try {
        const response = await fetch(`/api/channels/${channelId}/sections`);
        const data = await response.json();

        console.log('[ChannelSections] API response:', JSON.stringify(data, null, 2));

        if (data.success) {
          console.log('[ChannelSections] Loaded sections:', data.sections.length);
          setSections(data.sections);
        } else {
          console.error('[ChannelSections] Failed to load sections:', data.error);
          setError('Failed to load channel sections');
        }
      } catch (err) {
        console.error('[ChannelSections] Network error:', JSON.stringify(err, null, 2));
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
    console.error('[ChannelSections] Error state:', error);
    return null; // Fail silently on channel pages
  }

  if (sections.length === 0) {
    console.log('[ChannelSections] No sections to display');
    return null;
  }

  console.log('[ChannelSections] Rendering', sections.length, 'sections');

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
