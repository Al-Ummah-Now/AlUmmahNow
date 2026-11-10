'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { searchContent } from '@/lib/api/search';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { SelectedList, type PickedItem } from './SelectedList';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

interface ChannelPickerProps {
  /** This channel: it can't feature itself */
  channelId: string;
  value: PickedItem[];
  onChange: (items: PickedItem[]) => void;
  max: number;
  testId: string;
  label: string;
}

/**
 * Find channels with site search (name or @handle) and add them in order.
 * Search only returns listable channels; the API checks again on save.
 */
export function ChannelPicker({ channelId, value, onChange, max, testId, label }: ChannelPickerProps) {
  const { t, lang } = useLanguage();
  const f = t.channelSections.form;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < MIN_QUERY) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      searchContent({ q, type: 'channel', limit: 10 })
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            logger.warn('ChannelPicker: search failed', { status: result.status });
            setResults([]);
            return;
          }
          setResults(
            result.data.results.flatMap((hit) =>
              hit.type === 'channel'
                ? [{ id: hit.channel.id, label: getLocalizedValue(hit.channel.nameLocalized, hit.channel.name, lang), thumbnailUrl: hit.channel.avatarUrl, round: true }]
                : []
            )
          );
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, lang]);

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const full = value.length >= max;
  const candidates = (results ?? []).filter((c) => c.id !== channelId);

  return (
    <div className="space-y-3">
      <SelectedList items={value} onChange={onChange} testId={`${testId}-selected`} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {full ? f.maxReached : f.selectedCount.replace('{count}', String(value.length)).replace('{max}', String(max))}
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={f.searchChannels}
          aria-label={f.searchChannels}
          aria-describedby={`${testId}-hint`}
          className="ps-9"
          data-testid={`${testId}-search`}
        />
      </div>
      <p id={`${testId}-hint`} className="text-xs text-muted-foreground">
        {results === null ? f.searchChannelsHint : searching ? f.loading : candidates.length === 0 ? f.noChannelsFound : ''}
      </p>
      {candidates.length > 0 && (
        <ul aria-label={label} className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1" data-testid={`${testId}-options`}>
          {candidates.map((channel) => {
            const selected = selectedIds.has(channel.id);
            return (
              <li key={channel.id}>
                <button
                  type="button"
                  disabled={selected || full}
                  aria-pressed={selected}
                  onClick={() => onChange([...value, channel])}
                  data-channel-id={channel.id}
                  className="flex w-full items-center gap-3 rounded p-1.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {channel.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small avatar
                    <img src={channel.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-full bg-muted object-cover" />
                  ) : (
                    <span className="h-9 w-9 shrink-0 rounded-full bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">{channel.label}</span>
                  {!selected && <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
