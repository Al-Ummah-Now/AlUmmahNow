'use client';
/**
 * The video per email language (owner 2026-11-16: "one for Arabic, the other for English"), side by side
 * like the other localized fields. Each is the shared live search over public, ready, listed videos
 * (admin-api GET /api/invites/videos), opening with the newest; picture, title, channel and length.
 * An email uses its own language's video and never the other's.
 */
import { useCallback } from 'react';
import { formatDuration, type AdminSuggestion } from '@al-ummah/shared-types';
import { searchInviteVideos } from '@/lib/api/invites';
import { useLanguage } from '@/i18n/I18nProvider';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import type { AutocompleteItem } from '@/components/search/autocomplete-model';
import { logger } from '@/lib/logger-client';

export type InviteVideoValue = { en: string | null; ar: string | null };
export type InviteVideoItems = { en: AdminSuggestion | null; ar: AdminSuggestion | null };

export function InviteVideoPickers({
  value,
  items,
  onChange,
  testId,
  hint,
}: {
  value: InviteVideoValue;
  /** The chosen videos' picker items (the saved defaults), so the boxes show them at once */
  items?: InviteVideoItems;
  onChange: (lang: 'en' | 'ar', id: string | null) => void;
  testId: string;
  hint: string;
}) {
  const { t, locale } = useLanguage();
  const source = useCallback<AutocompleteSource>(
    async (q, cursor) => {
      const result = await searchInviteVideos(q, cursor);
      if (!result.ok) {
        logger.warn('[InviteVideoPickers] Video search failed', { status: result.status, code: result.code });
        throw new Error(`Video search answered ${result.status}`);
      }
      const clock = formatDuration(locale);
      // Channel and length under the title
      return {
        items: result.data.items.map((v): AutocompleteItem => ({ ...v, secondary: [v.secondary, v.duration ? clock(v.duration) : null].filter(Boolean).join(' • ') || null })),
        next: result.data.next,
      };
    },
    [locale],
  );
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {(['en', 'ar'] as const).map((lang) => (
          <Autocomplete
            key={lang}
            kind="video"
            mode="pick"
            label={t(lang === 'en' ? 'invites.videoEn' : 'invites.videoAr')}
            placeholder={t('invites.videoPlaceholder')}
            defaultValue={value[lang] ?? ''}
            defaultItem={items?.[lang] ?? null}
            source={source}
            allowIds={false}
            showIds={false}
            testId={`${testId}-${lang}`}
            messages={{
              recent: (count) => t('invites.videoRecent', { count }),
              emptyList: t('invites.videoNone'),
              noMatches: (query) => t('invites.videoNoMatch', { query }),
            }}
            onChange={(id) => onChange(lang, id || null)}
          />
        ))}
      </div>
      <span className="text-xs text-fg-subtle">{hint}</span>
    </div>
  );
}
