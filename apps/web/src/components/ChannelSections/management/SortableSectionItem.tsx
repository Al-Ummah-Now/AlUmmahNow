'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChannelSection, ChannelSectionType } from '@al-ummah/shared-types';
import { GripVertical, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SortableSectionItemProps {
  section: ChannelSection;
  onDelete: () => void;
  onEdit?: () => void;
}

const SECTION_TYPE_LABELS: Record<ChannelSectionType, string> = {
  featured_videos: 'Featured videos',
  recent_uploads: 'Recent uploads',
  popular_uploads: 'Popular uploads',
  single_playlist: 'Single playlist',
  multiple_playlists: 'Featured playlists',
  subscribed_channels: 'Subscribed channels',
  liked_videos: 'Liked videos',
};

function getSectionTypeLabel(type: ChannelSectionType): string {
  return SECTION_TYPE_LABELS[type] || type;
}

function getSectionContentSummary(section: ChannelSection): string {
  if (section.videoIds && section.videoIds.length > 0) {
    return `${section.videoIds.length} video${section.videoIds.length > 1 ? 's' : ''}`;
  }

  if (section.playlistIds && section.playlistIds.length > 0) {
    return `${section.playlistIds.length} playlist${section.playlistIds.length > 1 ? 's' : ''}`;
  }

  if (section.playlistId) {
    return '1 playlist';
  }

  if (section.channelIds && section.channelIds.length > 0) {
    return `${section.channelIds.length} channel${section.channelIds.length > 1 ? 's' : ''}`;
  }

  return 'Automatic content';
}

export function SortableSectionItem({
  section,
  onDelete,
  onEdit,
}: SortableSectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="
        flex
        items-center
        gap-3             /* Mobile: compact gap */
        md:gap-4          /* Desktop: more space */
        p-3               /* Mobile: compact padding */
        md:p-4            /* Desktop: more padding */
        bg-white
        dark:bg-gray-800
        border
        border-gray-200
        dark:border-gray-700
        rounded-lg
        hover:shadow-md
        dark:hover:shadow-gray-900
        transition-shadow
      "
    >
      {/* Drag handle - Touch-friendly on mobile */}
      <div
        {...attributes}
        {...listeners}
        className="
          cursor-grab
          active:cursor-grabbing
          text-gray-400
          hover:text-gray-600
          dark:text-gray-500
          dark:hover:text-gray-300
          min-w-[44px]      /* Touch-friendly size */
          min-h-[44px]
          flex
          items-center
          justify-center
          -ml-2             /* Compensate padding */
          md:-ml-3
        "
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-5 h-5" />
      </div>

      {/* Section info */}
      <div className="flex-1 min-w-0">
        <div className="
          font-medium
          text-sm            /* Mobile: smaller text */
          md:text-base       /* Desktop: normal text */
          text-gray-900
          dark:text-gray-100
          truncate
        ">
          {section.title || getSectionTypeLabel(section.type)}
        </div>
        <div className="
          text-xs            /* Mobile: extra small */
          md:text-sm         /* Desktop: small */
          text-gray-600
          dark:text-gray-400
          mt-0.5
        ">
          {getSectionContentSummary(section)}
        </div>
      </div>

      {/* Actions - Stack on very small screens */}
      <div className="
        flex
        gap-1              /* Mobile: compact gap */
        md:gap-2           /* Desktop: more space */
        flex-shrink-0
      ">
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="
              h-9 w-9        /* Touch-friendly size */
              md:h-8 md:w-8
              p-0
            "
            aria-label="Edit section"
          >
            <Edit className="w-4 h-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="
            h-9 w-9          /* Touch-friendly size */
            md:h-8 md:w-8
            p-0
            text-red-600
            hover:text-red-700
            hover:bg-red-50
            dark:text-red-400
            dark:hover:text-red-300
            dark:hover:bg-red-900/20
          "
          aria-label="Delete section"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
