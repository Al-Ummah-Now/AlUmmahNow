'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  CONSENT_REQUIRED_TYPES,
  SECTION_TYPE_GROUPS as TYPE_GROUPS,
  SECTION_TYPE_LIMITS,
  sectionLimitKey,
  type ChannelSectionCreateInput,
  type ChannelSectionType,
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
  History,
  Layers,
  Library,
  ListVideo,
  Lock,
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
import { SectionForm, type SectionPreset } from './SectionForm';
import { sectionLabelKey } from '../sectionData';
import { useLanguage } from '@/hooks/useLanguage';

/** A card in the dialog: a type, plus options for types that have two cards (live) */
export interface SectionCard {
  type: ChannelSectionType;
  preset?: SectionPreset;
}

type CardKey = ReturnType<typeof sectionLabelKey>;
type ExistingSection = { type: string; sort?: string; liveFilter?: string };
type TypeGroupId = keyof typeof TYPE_GROUPS;

/** Icons by card (the label key: live streams have one per filter) */
export const SECTION_ICONS: Record<CardKey, LucideIcon> = {
  channel_spotlight: Clapperboard,
  featured_videos: Sparkles,
  recent_uploads: Clock,
  popular_uploads: Flame,
  shorts: Smartphone,
  shorts_popular: Smartphone,
  live_streams: Radio,
  live_streams_past: History,
  liked_videos: ThumbsUp,
  single_playlist: ListVideo,
  multiple_playlists: Library,
  created_playlists: Layers,
  featured_channels: Tv,
  subscribed_channels: Users,
  community_posts: MessageSquare,
};

/** Cards per group, in the spec's order (§9); live streams get a card per filter */
export function sectionCards(group: TypeGroupId): SectionCard[] {
  return TYPE_GROUPS[group].flatMap<SectionCard>((type) =>
    type === 'live_streams'
      ? [{ type, preset: { liveFilter: 'live_and_upcoming' } }, { type, preset: { liveFilter: 'past' } }]
      : [{ type }]
  );
}

/** The picker's groups, in display order */
export const SECTION_CARD_GROUPS: { id: TypeGroupId; cards: SectionCard[] }[] = (Object.keys(TYPE_GROUPS) as TypeGroupId[]).map(
  (id) => ({ id, cards: sectionCards(id) })
);

export const cardKey = (card: SectionCard): CardKey => sectionLabelKey({ type: card.type, liveFilter: card.preset?.liveFilter });

/**
 * Whether a card can still be added, and with which options. Shorts can be
 * added once per order, so its card stays open until both orders exist.
 */
export function cardAvailability(card: SectionCard, existing: ExistingSection[]): { available: boolean; preset?: SectionPreset } {
  const limit = SECTION_TYPE_LIMITS[card.type];
  if (!limit) return { available: true, preset: card.preset };
  const count = (key: string) => existing.filter((s) => sectionLimitKey(s) === key).length;
  if (card.type === 'shorts') {
    if (count('shorts:latest') < limit) return { available: true, preset: { sort: 'latest' } };
    if (count('shorts:popular') < limit) return { available: true, preset: { sort: 'popular' } };
    return { available: false };
  }
  const key = sectionLimitKey({ type: card.type, ...card.preset });
  return { available: count(key) < limit, preset: card.preset };
}

interface AddSectionDialogProps {
  channelId: string;
  /** The channel's sections, to close cards at their per-type limit */
  existing: ExistingSection[];
  /** Only the channel owner can show their subscriptions or likes */
  canGrantConsent: boolean;
  /** Resolves to a localized error message, or null when the section was added */
  onAdd: (section: ChannelSectionCreateInput) => Promise<string | null>;
  disabled?: boolean;
}

export function AddSectionDialog({ channelId, existing, canGrantConsent, onAdd, disabled }: AddSectionDialogProps) {
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;
  const cs = t.channelSections;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SectionCard | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const allCards = SECTION_CARD_GROUPS.flatMap((group) => group.cards);
  const firstAvailable = () => cardKey(allCards.find((card) => cardAvailability(card, existing).available) ?? allCards[0]);
  // Roving focus: one option is in the tab order, the arrow keys move between them
  const [activeKey, setActiveKey] = useState<CardKey>(firstAvailable);
  const optionsRef = useRef<HTMLDivElement>(null);
  const refocusOption = useRef(false);
  const idBase = useId();

  // The picker replaces the form in place, so focus would fall to the page: put it back on the option
  useEffect(() => {
    if (selected || !refocusOption.current) return;
    refocusOption.current = false;
    optionsRef.current?.querySelector<HTMLButtonElement>(`[data-section-card="${activeKey}"]`)?.focus();
  }, [selected, activeKey]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setActiveKey(firstAvailable());
    if (!next) {
      setSelected(null);
      setIsCreating(false);
      setServerError(null);
    }
  };

  const handleFormSubmit = async (data: ChannelSectionCreateInput) => {
    setIsCreating(true);
    setServerError(null);
    const error = await onAdd(data);
    setIsCreating(false);
    if (error) setServerError(error);
    else handleOpenChange(false);
  };

  // Back from the form: focus returns to the option that was picked
  const handleBack = () => {
    if (selected) setActiveKey(cardKey(selected));
    refocusOption.current = true;
    setSelected(null);
    setServerError(null);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const options = Array.from(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[data-section-card]:not(:disabled)') ?? []);
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
    setActiveKey(target.dataset.sectionCard as CardKey);
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
          <Plus className="w-4 h-4 me-2" aria-hidden="true" />
          {s.addSection}
        </Button>
      </DialogTrigger>

      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto rounded-lg p-4 md:p-6"
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="add-section-dialog"
      >
        <DialogHeader className="pe-10 text-start sm:text-start">
          <DialogTitle className="text-lg md:text-xl leading-snug">
            {selected ? cs.labels[cardKey(selected)] : s.addChannelSection}
          </DialogTitle>
          <DialogDescription className="opt-lede">
            {selected ? cs.descriptions[cardKey(selected)] : s.chooseSectionType}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div ref={optionsRef} className="opt-groups" data-testid="section-type-options">
            {SECTION_CARD_GROUPS.map((group) => {
              const headingId = `${idBase}-${group.id}`;
              return (
                <div key={group.id} role="group" aria-labelledby={headingId} className="opt-group" data-section-group={group.id}>
                  <h3 id={headingId} className="opt-heading">
                    {s.typeGroups[group.id]}
                  </h3>
                  <div className="opt-grid">
                    {group.cards.map((card) => {
                      const key = cardKey(card);
                      const { available, preset } = cardAvailability(card, existing);
                      const Icon = SECTION_ICONS[key];
                      const isPrivate = CONSENT_REQUIRED_TYPES.includes(card.type);
                      return (
                        <button
                          key={key}
                          type="button"
                          className="opt"
                          data-section-type={card.type}
                          data-section-card={key}
                          disabled={!available}
                          tabIndex={key === activeKey ? 0 : -1}
                          onClick={() => setSelected({ type: card.type, preset })}
                          onFocus={() => setActiveKey(key)}
                          onKeyDown={handleOptionKeyDown}
                        >
                          <span className="opt-icon" aria-hidden="true">
                            <Icon />
                          </span>
                          {/* The name is everything the card shows (WCAG 2.5.3): spaces keep the parts apart */}
                          <span className="opt-text">
                            <span className="opt-title">{cs.labels[key]}</span>{' '}
                            <span className="opt-desc">{available ? cs.descriptions[key] : cs.alreadyAdded}</span>
                            {isPrivate && (
                              <>
                                {' '}
                                <span className="opt-tag">
                                  <Lock aria-hidden="true" />
                                  {cs.privateData}
                                </span>
                              </>
                            )}
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
              key={cardKey(selected)}
              channelId={channelId}
              sectionType={selected.type}
              preset={selected.preset}
              canGrantConsent={canGrantConsent}
              serverError={serverError}
              onSubmit={handleFormSubmit}
              onCancel={handleBack}
              cancelLabel={cs.back}
              isLoading={isCreating}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
