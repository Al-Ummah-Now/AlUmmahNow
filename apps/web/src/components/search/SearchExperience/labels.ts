/**
 * Localised labels for search types and filters (Story 29.8).
 */

import type { SearchDateFilter, SearchDurationFilter, SearchEntityType, SearchSort } from '@al-ummah/shared-types';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import type { AppTranslations } from '@/lib/i18n/types';
import type { SearchFilterKey, SearchUrlState } from '@/lib/search/url-state';

type Search = AppTranslations['search'];

export function typeLabel(t: Search, type: SearchEntityType | undefined): string {
  switch (type) {
    case 'video': return t.typeVideos;
    case 'channel': return t.typeChannels;
    case 'playlist': return t.typePlaylists;
    case 'post': return t.typePosts;
    default: return t.typeAll;
  }
}

export function durationLabel(t: Search, value: SearchDurationFilter | undefined): string {
  switch (value) {
    case 'short': return t.short;
    case 'medium': return t.medium;
    case 'long': return t.long;
    default: return t.anyDuration;
  }
}

export function dateLabel(t: Search, value: SearchDateFilter | undefined): string {
  switch (value) {
    case 'hour': return t.lastHour;
    case 'today': return t.today;
    case 'week': return t.thisWeek;
    case 'month': return t.thisMonth;
    case 'year': return t.thisYear;
    default: return t.anyDate;
  }
}

export function languageLabel(t: Search, value: string | undefined): string {
  switch (value) {
    case 'en': return t.english;
    case 'ar': return t.arabic;
    case 'ur': return t.urdu;
    case 'fr': return t.french;
    default: return t.allLanguages;
  }
}

export function sortLabel(t: Search, value: SearchSort): string {
  switch (value) {
    case 'date': return t.sortNewest;
    case 'popular': return t.sortPopular;
    default: return t.relevance;
  }
}

export function categoryLabel(value: string | undefined, lang: string, fallback: string): string {
  if (!value) return fallback;
  const def = VIDEO_CATEGORIES.find(c => c.value === value);
  if (!def) return value;
  return lang === 'ar' ? def.label.ar : def.label.en;
}

export function filterChipLabel(
  t: Search,
  key: SearchFilterKey,
  state: SearchUrlState,
  lang: string,
  channelName?: string,
): string {
  switch (key) {
    case 'duration': return durationLabel(t, state.duration);
    case 'date': return dateLabel(t, state.date);
    case 'language': return languageLabel(t, state.language);
    case 'category': return categoryLabel(state.category, lang, t.allCategories);
    case 'verified': return t.verified;
    case 'channelId': return t.inChannel.replace('{name}', channelName || t.thisChannel);
  }
}

export function formatCount(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
}
