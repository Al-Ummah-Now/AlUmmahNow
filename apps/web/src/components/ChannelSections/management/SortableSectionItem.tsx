'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChannelSection } from '@al-ummah/shared-types';
import { GripVertical, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import type { AppTranslations } from '@/lib/i18n/types';

interface SortableSectionItemProps {
  section: ChannelSection;
  onDelete: () => void;
  onEdit?: () => void;
}

type SectionStrings = AppTranslations['channelManage']['sections'];

export function getSectionContentSummary(section: ChannelSection, s: SectionStrings): string {
  if (section.videoIds && section.videoIds.length > 0) {
    return s.videosCount.replace('{count}', String(section.videoIds.length));
  }
  if (section.playlistIds && section.playlistIds.length > 0) {
    return s.playlistsCount.replace('{count}', String(section.playlistIds.length));
  }
  if (section.playlistId) {
    return s.playlistsCount.replace('{count}', '1');
  }
  if (section.channelIds && section.channelIds.length > 0) {
    return s.channelsCount.replace('{count}', String(section.channelIds.length));
  }
  return s.automaticContent;
}

export function SortableSectionItem({
  section,
  onDelete,
  onEdit,
}: SortableSectionItemProps) {
  const { t } = useLanguage();
  const s = t.channelManage.sections;
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

  const title = section.title || s.typeLabels[section.type] || section.type;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="section-item"
      data-section-id={section.id}
      className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md dark:hover:shadow-gray-900 transition-shadow"
    >
      {/* Drag handle - touch-friendly size */}
      <div
        {...attributes}
        {...listeners}
        data-testid="section-drag-handle"
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 min-w-[44px] min-h-[44px] flex items-center justify-center -ms-2 md:-ms-3"
        aria-label={`${s.dragToReorder}: ${title}`}
      >
        <GripVertical className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm md:text-base text-gray-900 dark:text-gray-100 truncate" data-testid="section-item-title">
          {title}
        </div>
        <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          {s.typeLabels[section.type] || section.type} · {getSectionContentSummary(section, s)}
        </div>
      </div>

      <div className="flex gap-1 md:gap-2 flex-shrink-0">
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="h-9 w-9 md:h-8 md:w-8 p-0"
            aria-label={`${s.editSection}: ${title}`}
          >
            <Edit className="w-4 h-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-9 w-9 md:h-8 md:w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
          aria-label={`${s.deleteSection}: ${title}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
