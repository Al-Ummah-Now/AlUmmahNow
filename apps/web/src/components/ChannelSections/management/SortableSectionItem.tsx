'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { EyeOff, GripVertical, Pencil, Pin, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import type { AppTranslations } from '@/lib/i18n/types';
import { resolveSectionTitle, sectionLabelKey, type PopulatedChannelSection } from '../sectionData';
import { SECTION_ICONS } from './AddSectionDialog';

interface SortableSectionItemProps {
  section: PopulatedChannelSection;
  onDelete: () => void;
  onEdit?: () => void;
  /** The spotlight always leads the Home tab, so it isn't dragged */
  pinned?: boolean;
}

type SectionStrings = AppTranslations['channelManage']['sections'];

/** Picked content of a section ("Videos: 3"), or "Automatic content" */
export function getSectionContentSummary(section: PopulatedChannelSection, s: SectionStrings): string {
  const content = { ...section.content, ...pickFlat(section) };
  const spotlight = [content.trailerVideoId, content.returningVideoId].filter(Boolean).length;
  if (content.videoIds?.length) return s.videosCount.replace('{count}', String(content.videoIds.length));
  if (spotlight) return s.videosCount.replace('{count}', String(spotlight));
  if (content.playlistIds?.length) return s.playlistsCount.replace('{count}', String(content.playlistIds.length));
  if (content.playlistId) return s.playlistsCount.replace('{count}', '1');
  if (content.channelIds?.length) return s.channelsCount.replace('{count}', String(content.channelIds.length));
  return s.automaticContent;
}

/** Older responses had the ids at the top level */
function pickFlat(section: PopulatedChannelSection) {
  const flat: NonNullable<PopulatedChannelSection['content']> = {};
  if (section.videoIds?.length) flat.videoIds = section.videoIds;
  if (section.playlistIds?.length) flat.playlistIds = section.playlistIds;
  if (section.playlistId) flat.playlistId = section.playlistId;
  if (section.channelIds?.length) flat.channelIds = section.channelIds;
  return flat;
}

export function SortableSectionItem({ section, onDelete, onEdit, pinned = false }: SortableSectionItemProps) {
  const { t, locale } = useLanguage();
  const s = t.channelManage.sections;
  const cs = t.channelSections;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: pinned });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const labelKey = sectionLabelKey(section);
  const typeLabel = cs.labels[labelKey] ?? section.type;
  const title = resolveSectionTitle(getLocalizedValue(section.titleLocalized, section.title, locale), typeLabel);
  const hidden = !!section.isEmpty || !!section.emptyHint;
  const Icon = SECTION_ICONS[labelKey] ?? Star;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="section-item"
      data-section-id={section.id}
      data-section-type={section.type}
      data-hidden={hidden || undefined}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground md:gap-4 md:p-4"
    >
      {pinned ? (
        <span className="-ms-2 flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground md:-ms-3" title={cs.pinnedFirst}>
          <Pin className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">{cs.pinnedFirst}</span>
        </span>
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          data-testid="section-drag-handle"
          className="-ms-2 flex min-h-[44px] min-w-[44px] cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:-ms-3"
          aria-label={`${s.dragToReorder}: ${title}`}
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink sm:flex" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground md:text-base" data-testid="section-item-title" dir="auto">
            {title}
          </span>
          {hidden && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              title={cs.emptyHints[section.emptyHint ?? 'noContent']}
              data-testid="section-hidden-badge"
            >
              <EyeOff className="h-3 w-3" aria-hidden="true" />
              {cs.hidden}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground md:text-sm">
          {title !== typeLabel && (
            <>
              {typeLabel}
              <span aria-hidden="true">{', '}</span>
            </>
          )}
          {getSectionContentSummary(section, s)}
        </div>
        {hidden && <p className="sr-only">{cs.emptyHints[section.emptyHint ?? 'noContent']}</p>}
      </div>

      <div className="flex shrink-0 gap-1 md:gap-2">
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-9 w-9 p-0 md:h-8 md:w-8" aria-label={`${s.editSection}: ${title}`} data-testid="section-edit">
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-9 w-9 p-0 text-destructive hover:bg-muted md:h-8 md:w-8"
          aria-label={`${s.deleteSection}: ${title}`}
          data-testid="section-delete"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
