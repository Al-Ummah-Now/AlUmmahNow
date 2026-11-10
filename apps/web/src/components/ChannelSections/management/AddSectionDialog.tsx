'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChannelSectionType,
  ChannelSectionCreateInput,
  SECTION_TYPE_GROUPS as TYPE_GROUPS,
} from '@al-ummah/shared-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  ChevronRight,
  Clapperboard,
  Clock,
  Flame,
  Layers,
  Library,
  ListVideo,
  MessageSquare,
  Plus,
  Radio,
  Smartphone,
  Sparkles,
  ThumbsUp,
  Tv,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { SectionForm } from './SectionForm';
import { useLanguage } from '@/hooks/useLanguage';

interface AddSectionDialogProps {
  channelId: string;
  onAdd: (section: ChannelSectionCreateInput) => void | Promise<void>;
  disabled?: boolean;
}

export const SECTION_TYPES: ChannelSectionType[] = [
  'featured_videos',
  'recent_uploads',
  'popular_uploads',
  'single_playlist',
  'multiple_playlists',
  'subscribed_channels',
  'liked_videos',
];

type TypeGroupId = keyof typeof TYPE_GROUPS;

/** The picker's groups, in display order: the shared grouping, holding only the types offered here */
export const SECTION_TYPE_GROUPS: { id: TypeGroupId; types: ChannelSectionType[] }[] = (
  Object.keys(TYPE_GROUPS) as TypeGroupId[]
)
  .map((id) => ({ id, types: TYPE_GROUPS[id].filter((type) => SECTION_TYPES.includes(type)) }))
  .filter((group) => group.types.length > 0);

export const SECTION_TYPE_ICONS: Record<ChannelSectionType, LucideIcon> = {
  featured_videos: Sparkles,
  recent_uploads: Clock,
  popular_uploads: Flame,
  liked_videos: ThumbsUp,
  single_playlist: ListVideo,
  multiple_playlists: Library,
  subscribed_channels: Users,
  channel_spotlight: Clapperboard,
  shorts: Smartphone,
  live_streams: Radio,
  created_playlists: Layers,
  featured_channels: Tv,
  community_posts: MessageSquare,
};

export function AddSectionDialog({ channelId, onAdd, disabled }: AddSectionDialogProps) {
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ChannelSectionType | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Roving focus: one option is in the tab order, the arrow keys move between them
  const [activeType, setActiveType] = useState<ChannelSectionType>(SECTION_TYPE_GROUPS[0].types[0]);
  const optionsRef = useRef<HTMLDivElement>(null);
  const refocusOption = useRef(false);
  const idBase = useId();

  // The picker replaces the form in place, so focus would fall to the page: put it back on the option
  useEffect(() => {
    if (selectedType || !refocusOption.current) return;
    refocusOption.current = false;
    optionsRef.current?.querySelector<HTMLButtonElement>(`[data-section-type="${activeType}"]`)?.focus();
  }, [selectedType, activeType]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSelectedType(null);
      setIsCreating(false);
      setActiveType(SECTION_TYPE_GROUPS[0].types[0]);
    }
  };

  const handleFormSubmit = async (data: ChannelSectionCreateInput) => {
    setIsCreating(true);
    try {
      await onAdd(data);
      handleOpenChange(false);
    } catch (_error) {
      // Error already logged and shown by the parent page
    } finally {
      setIsCreating(false);
    }
  };

  // Back from the form: focus returns to the option that was picked
  const handleCancel = () => {
    if (selectedType) setActiveType(selectedType);
    refocusOption.current = true;
    setSelectedType(null);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const options = Array.from(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[data-section-type]') ?? []);
    const index = options.indexOf(event.currentTarget);
    if (index < 0) return;
    // In Arabic the next option is to the left
    const forward = isRTL ? 'ArrowLeft' : 'ArrowRight';
    const back = isRTL ? 'ArrowRight' : 'ArrowLeft';
    let next = -1;
    if (event.key === 'ArrowDown' || event.key === forward) next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp' || event.key === back) next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = options[next];
    setActiveType(target.dataset.sectionType as ChannelSectionType);
    target.focus();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full h-11 md:h-10 text-sm md:text-base"
          disabled={disabled}
          data-testid="add-section-button"
        >
          <Plus className="w-4 h-4 me-2" />
          {s.addSection}
        </Button>
      </DialogTrigger>

      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] md:max-h-[80vh] overflow-y-auto rounded-lg p-4 md:p-6"
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="add-section-dialog"
      >
        <DialogHeader className="pe-10 text-start sm:text-start">
          <DialogTitle className="text-lg md:text-xl leading-snug">
            {selectedType ? s.configureSection : s.addChannelSection}
          </DialogTitle>
          <DialogDescription className="opt-lede">
            {selectedType ? s.typeDescriptions[selectedType] : s.chooseSectionType}
          </DialogDescription>
        </DialogHeader>

        {!selectedType ? (
          <div ref={optionsRef} className="opt-groups" data-testid="section-type-options">
            {SECTION_TYPE_GROUPS.map((group) => {
              const headingId = `${idBase}-${group.id}`;
              return (
                <div key={group.id} role="group" aria-labelledby={headingId} className="opt-group">
                  <h3 id={headingId} className="opt-heading">
                    {s.typeGroups[group.id]}
                  </h3>
                  <div className="opt-grid">
                    {group.types.map((type) => {
                      const Icon = SECTION_TYPE_ICONS[type];
                      return (
                        <button
                          key={type}
                          type="button"
                          className="opt"
                          data-section-type={type}
                          tabIndex={type === activeType ? 0 : -1}
                          onClick={() => setSelectedType(type)}
                          onFocus={() => setActiveType(type)}
                          onKeyDown={handleOptionKeyDown}
                        >
                          <span className="opt-icon" aria-hidden="true">
                            <Icon />
                          </span>
                          {/* The name is everything the card shows (WCAG 2.5.3): the space keeps title and description apart */}
                          <span className="opt-text">
                            <span className="opt-title">{s.typeLabels[type]}</span>{' '}
                            <span className="opt-desc">
                              {s.typeDescriptions[type]}
                            </span>
                          </span>
                          <ChevronRight className="opt-go" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-2">
            <SectionForm
              channelId={channelId}
              sectionType={selectedType}
              onSubmit={handleFormSubmit}
              onCancel={handleCancel}
              isLoading={isCreating}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
