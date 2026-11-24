'use client';

/** The videos that can become a premiere: the channel's own, ready, and not open to anyone yet. The server checks again. */
import { useState } from 'react';
import { formatClock, isShort } from '@al-ummah/shared-types';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';
import type { StudioVideo } from '@/lib/api/studio-content';
import { fetchContentPage } from '@/lib/studio/content-client';

const PAGE = 30;

export function canPremiere(v: StudioVideo): boolean {
  const open = v.isPublic !== false || v.isUnlisted === true;
  const pending = v.scheduledPublishStatus === 'scheduled' || v.scheduledPublishStatus === 'publishing';
  return (v.isDraft || !open) && !pending && !v.premiereHold && Number(v.duration) > 0 && !isShort(v as never) && (v.uploadStatus === undefined || v.uploadStatus === 'ready');
}

export interface PremiereVideo {
  id: string;
  title: string;
}

export function PremiereVideoPicker({ channelId, inputId, onPick, except }: { channelId: string; inputId: string; onPick: (video: PremiereVideo) => void; except?: string }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const [query, setQuery] = useState('');
  const toOption = (v: StudioVideo): AutocompleteOption => {
    const title = (v as { titleLocalized?: Record<string, string> }).titleLocalized?.[lang] || v.title;
    return { id: v.id, label: title, subtitle: formatClock(lang, Number(v.duration) || 0), thumbnailUrl: v.thumbnailUrl || undefined, thumbnailShape: 'wide', value: { id: v.id, title } };
  };
  const usable = (list: StudioVideo[]) => list.filter((v) => v.id !== except && canPremiere(v)).map(toOption);
  const load = async (q: string | undefined, drafts: string | null, signal: AbortSignal) => {
    const [priv, draft] = await Promise.all([
      // Private ones once, with the first page of drafts
      drafts === null ? fetchContentPage(channelId, { status: 'published', visibility: 'private', q, limit: PAGE }, signal) : null,
      fetchContentPage(channelId, { status: 'drafts', q, limit: PAGE, cursor: drafts ?? undefined }, signal),
    ]);
    return { options: usable([...(priv?.items ?? []), ...draft.items]), next: draft.cursor };
  };
  return (
    <Autocomplete
      value={query}
      onValueChange={setQuery}
      load={async (q, signal) => (await load(q, null, signal)).options}
      loadInitial={(cursor, signal) => load(undefined, cursor, signal)}
      loadKey={`${channelId}:${lang}:${except ?? ''}`}
      minChars={1}
      maxOptions={2 * PAGE}
      emptyText={text.videoEmpty}
      onSelect={(option) => {
        setQuery('');
        onPick(option.value as PremiereVideo);
      }}
      label={text.videoPick}
      listLabel={text.videoPick}
      inputId={inputId}
      inputProps={{ type: 'search', placeholder: text.videoPick }}
      inputClassName="f-input w-full py-2 text-sm"
      testId="studio-premiere-video"
      popupTestId="studio-premiere-videos"
    />
  );
}
