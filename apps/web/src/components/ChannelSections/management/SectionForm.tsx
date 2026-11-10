'use client';

import { useState, type ReactNode } from 'react';
import {
  CHANNEL_SECTION_CONSTRAINTS as LIMITS,
  CONSENT_REQUIRED_TYPES,
  TITLE_REQUIRED_TYPES,
  type ChannelSectionCreateInput,
  type ChannelSectionType,
  type LiveFilter,
  type PostMode,
  type SectionSort,
} from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveSectionTitle, sectionLabelKey, type PopulatedChannelSection } from '../sectionData';
import { VideoPicker, toPickedVideo } from './pickers/VideoPicker';
import { PlaylistPicker, toPickedPlaylist } from './pickers/PlaylistPicker';
import { ChannelPicker } from './pickers/ChannelPicker';
import type { PickedItem } from './pickers/SelectedList';

/** Options a dialog card sets before the form opens (Past live streams is its own card) */
export interface SectionPreset {
  sort?: SectionSort;
  liveFilter?: LiveFilter;
}

interface SectionFormProps {
  channelId: string;
  sectionType: ChannelSectionType;
  preset?: SectionPreset;
  /** The section being edited, as the populated list returns it */
  initial?: PopulatedChannelSection;
  /** Only the channel owner can show their subscriptions or likes */
  canGrantConsent: boolean;
  /** A localized message for a rejected save */
  serverError?: string | null;
  onSubmit: (data: ChannelSectionCreateInput) => void;
  onCancel: () => void;
  /** Label of the cancel button: Back in the add dialog, Cancel when editing */
  cancelLabel: string;
  isLoading?: boolean;
  mode?: 'create' | 'edit';
}

const VIDEO_TYPES: ChannelSectionType[] = ['featured_videos'];
const COUNT_TYPES: ChannelSectionType[] = [
  'recent_uploads', 'popular_uploads', 'shorts', 'live_streams', 'liked_videos',
  'single_playlist', 'created_playlists', 'subscribed_channels',
];
const COUNT_CHOICES = [4, 6, 8, 12, 16, 20];
const POST_COUNT_CHOICES = [1, 2, 3, 4, 5, 6];

/** Initial picks from the populated content the manager already loaded */
function initialPicks(section: PopulatedChannelSection | undefined, lang: string) {
  const content = section?.populatedContent ?? {};
  const playlists = content.playlists ?? (content.playlist ? [content.playlist] : []);
  return {
    videos: (section?.type === 'featured_videos' ? content.videos ?? [] : []).map((v) => toPickedVideo(v, lang)),
    trailer: content.spotlight?.trailer ? [toPickedVideo(content.spotlight.trailer, lang)] : [],
    returning: content.spotlight?.returning ? [toPickedVideo(content.spotlight.returning, lang)] : [],
    playlists: playlists.map((p) => toPickedPlaylist(p as never, lang)),
    channels: (content.channels ?? []).map<PickedItem>((c) => ({
      id: c.id,
      label: (c.nameLocalized?.[lang] || c.name) ?? c.id,
      thumbnailUrl: c.avatarUrl,
      round: true,
    })),
  };
}

/**
 * The config step of the add and edit flow: the title, then the pickers and
 * options the section type needs (docs/specs/CHANNEL-SECTIONS.md §9).
 */
export function SectionForm({
  channelId,
  sectionType,
  preset,
  initial,
  canGrantConsent,
  serverError,
  onSubmit,
  onCancel,
  cancelLabel,
  isLoading = false,
  mode = 'create',
}: SectionFormProps) {
  const { t, lang, isRTL } = useLanguage();
  const cs = t.channelSections;
  const f = cs.form;
  const legacy = t.channelManage.sections.form;
  const picks = initialPicks(initial, lang);

  const sort = initial?.sort ?? preset?.sort;
  const liveFilter = initial?.liveFilter ?? preset?.liveFilter;
  const defaultTitle = cs.labels[sectionLabelKey({ type: sectionType, sort, liveFilter })];
  const storedTitle = initial ? resolveSectionTitle(initial.title, '') : '';

  const [title, setTitle] = useState(storedTitle);
  const [videos, setVideos] = useState<PickedItem[]>(picks.videos);
  const [trailer, setTrailer] = useState<PickedItem[]>(picks.trailer);
  const [returning, setReturning] = useState<PickedItem[]>(picks.returning);
  const [playlists, setPlaylists] = useState<PickedItem[]>(picks.playlists);
  const [channels, setChannels] = useState<PickedItem[]>(picks.channels);
  const [shortsSort, setShortsSort] = useState<SectionSort>(sort ?? 'latest');
  const [postMode, setPostMode] = useState<PostMode>(initial?.postMode ?? 'latest');
  const [itemCount, setItemCount] = useState<number>(
    initial?.itemCount ?? (sectionType === 'community_posts' ? LIMITS.DEFAULT_POST_COUNT : LIMITS.DEFAULT_ITEM_COUNT)
  );
  const [consent, setConsent] = useState<boolean>(initial?.consented ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsTitle = TITLE_REQUIRED_TYPES.includes(sectionType);
  const needsConsent = CONSENT_REQUIRED_TYPES.includes(sectionType);
  const isSpotlight = sectionType === 'channel_spotlight';

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    const trimmed = title.trim();
    if (needsTitle && !trimmed) next.title = f.titleRequiredHint;
    else if (trimmed.length > LIMITS.MAX_TITLE_LENGTH) next.title = legacy.titleTooLong;
    else if (/[<>]/.test(trimmed)) next.title = legacy.titleInvalidChars;

    if (VIDEO_TYPES.includes(sectionType) && videos.length === 0) next.videos = f.pickRequired;
    if (isSpotlight && trailer.length === 0 && returning.length === 0) next.spotlight = f.spotlightNeedsOne;
    if ((sectionType === 'single_playlist' || sectionType === 'multiple_playlists') && playlists.length === 0) {
      next.playlists = f.pickRequired;
    }
    if (sectionType === 'featured_channels' && channels.length === 0) next.channels = f.pickRequired;
    if (needsConsent && mode === 'create' && !consent) next.consent = f.consentRequired;

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    // The API needs a title; "<type> section" renders as the localized default
    const data: ChannelSectionCreateInput = { type: sectionType, title: title.trim() || `${sectionType} section` };
    if (VIDEO_TYPES.includes(sectionType)) data.videoIds = videos.map((v) => v.id);
    if (isSpotlight) {
      const trailerId = trailer[0]?.id;
      const returningId = returning[0]?.id;
      // On edit a removed video is cleared with null; on create it's left out
      if (trailerId || mode === 'edit') (data as { trailerVideoId?: string | null }).trailerVideoId = trailerId ?? null;
      if (returningId || mode === 'edit') (data as { returningVideoId?: string | null }).returningVideoId = returningId ?? null;
    }
    if (sectionType === 'single_playlist') data.playlistId = playlists[0]?.id;
    if (sectionType === 'multiple_playlists') data.playlistIds = playlists.map((p) => p.id);
    if (sectionType === 'featured_channels') data.channelIds = channels.map((c) => c.id);
    if (sectionType === 'shorts') data.sort = shortsSort;
    if (sectionType === 'live_streams') data.liveFilter = liveFilter ?? 'live_and_upcoming';
    if (sectionType === 'community_posts') data.postMode = postMode;
    if (COUNT_TYPES.includes(sectionType) || (sectionType === 'community_posts' && postMode === 'latest')) {
      data.itemCount = itemCount;
    }
    if (needsConsent && canGrantConsent && (mode === 'create' || consent !== (initial?.consented ?? false))) {
      data.consent = consent;
    }
    onSubmit(data);
  };

  const submitLabel = mode === 'edit' ? (isLoading ? legacy.saving : legacy.saveSection) : isLoading ? legacy.creating : legacy.createSection;
  const countChoices = sectionType === 'community_posts' ? POST_COUNT_CHOICES : COUNT_CHOICES;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'} data-testid="section-form" data-section-type={sectionType} noValidate>
      {!isSpotlight && (
        <Field id="section-title" label={legacy.sectionTitle} required={needsTitle} error={errors.title}
          hint={needsTitle ? f.titleRequiredHint : f.titleOptional}>
          <Input
            id="section-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={needsTitle ? '' : defaultTitle}
            maxLength={LIMITS.MAX_TITLE_LENGTH}
            dir="auto"
            aria-invalid={!!errors.title}
            data-testid="section-title-input"
          />
        </Field>
      )}

      {VIDEO_TYPES.includes(sectionType) && (
        <Fieldset legend={f.pickVideos} error={errors.videos}>
          <VideoPicker channelId={channelId} value={videos} onChange={setVideos} max={LIMITS.MAX_VIDEO_IDS} anyChannel testId="video-picker" label={f.videos} />
        </Fieldset>
      )}

      {isSpotlight && (
        <>
          <Fieldset legend={f.spotlightTrailer} hint={f.spotlightTrailerHint} error={errors.spotlight}>
            <VideoPicker channelId={channelId} value={trailer} onChange={setTrailer} max={1} testId="spotlight-trailer" label={f.spotlightTrailer} />
          </Fieldset>
          <Fieldset legend={f.spotlightReturning} hint={f.spotlightReturningHint}>
            <VideoPicker channelId={channelId} value={returning} onChange={setReturning} max={1} testId="spotlight-returning" label={f.spotlightReturning} />
          </Fieldset>
        </>
      )}

      {(sectionType === 'single_playlist' || sectionType === 'multiple_playlists') && (
        <Fieldset legend={sectionType === 'single_playlist' ? f.pickPlaylist : f.pickPlaylists} error={errors.playlists}>
          <PlaylistPicker
            channelId={channelId}
            value={playlists}
            onChange={setPlaylists}
            max={sectionType === 'single_playlist' ? 1 : LIMITS.MAX_PLAYLIST_IDS}
            testId="playlist-picker"
            label={f.playlists}
          />
        </Fieldset>
      )}

      {sectionType === 'featured_channels' && (
        <Fieldset legend={f.channels} error={errors.channels}>
          <ChannelPicker channelId={channelId} value={channels} onChange={setChannels} max={LIMITS.MAX_CHANNEL_IDS} testId="channel-picker" label={f.channels} />
        </Fieldset>
      )}

      {sectionType === 'shorts' && (
        <Choice
          name="shorts-sort"
          legend={f.sort}
          value={shortsSort}
          onChange={(v) => setShortsSort(v as SectionSort)}
          options={[['latest', f.sortLatest], ['popular', f.sortPopular]]}
          disabled={mode === 'edit'}
        />
      )}

      {sectionType === 'community_posts' && (
        <Choice
          name="post-mode"
          legend={f.postMode}
          value={postMode}
          onChange={(v) => setPostMode(v as PostMode)}
          options={[['latest', f.postLatest], ['pinned', f.postPinned]]}
        />
      )}

      {(COUNT_TYPES.includes(sectionType) || (sectionType === 'community_posts' && postMode === 'latest')) && (
        <Field id="section-item-count" label={sectionType === 'community_posts' ? f.postCount : f.itemCount}>
          <select
            id="section-item-count"
            value={itemCount}
            onChange={(e) => setItemCount(Number(e.target.value))}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
            data-testid="section-item-count"
          >
            {[...new Set([...countChoices, itemCount])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>{n.toLocaleString(lang)}</option>
            ))}
          </select>
        </Field>
      )}

      {needsConsent && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={consent}
              disabled={!canGrantConsent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              aria-describedby="section-consent-text"
              aria-invalid={!!errors.consent}
              data-testid="section-consent"
            />
            <span className="text-sm">
              <span className="block font-medium text-foreground">{f.consentLabel}</span>
              <span id="section-consent-text" className="block text-muted-foreground">
                {canGrantConsent
                  ? sectionType === 'subscribed_channels' ? f.consentSubscriptions : f.consentLikes
                  : f.ownerOnlyConsent}
              </span>
            </span>
          </label>
          {errors.consent && <p role="alert" className="mt-2 text-xs text-destructive">{errors.consent}</p>}
        </div>
      )}

      {serverError && (
        <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive" data-testid="section-form-error">
          {serverError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={isLoading} data-testid="section-form-submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, required, hint, error, children }: {
  id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ms-0.5 text-destructive" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Fieldset({ legend, hint, error, children }: { legend: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

function Choice({ name, legend, value, onChange, options, disabled }: {
  name: string; legend: string; value: string; onChange: (value: string) => void;
  options: Array<[string, string]>; disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <label
            key={optionValue}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground has-[:checked]:border-brand-edge has-[:checked]:bg-brand-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
              className="accent-brand"
              data-testid={`${name}-${optionValue}`}
            />
            {optionLabel}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
