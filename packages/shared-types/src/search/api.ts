/**
 * Search v2 and Explore API contracts (Stories 29.7, 29.8).
 * GET /api/search, GET /api/explore
 */

import type {
  SearchChannelPayload,
  SearchEntityType,
  SearchPlaylistPayload,
  SearchPostPayload,
  SearchVideoPayload,
} from './documents';
import type { VideoFormat } from '../video-format';

export type SearchDurationFilter = 'short' | 'medium' | 'long';
export type SearchDateFilter = 'hour' | 'today' | 'week' | 'month' | 'year';
export type SearchSort = 'relevance' | 'date' | 'popular';

/** Duration bounds in seconds: short < 4 min, medium 4-20 min, long > 20 min. */
export const SEARCH_DURATION_BOUNDS: Readonly<Record<SearchDurationFilter, { min?: number; max?: number }>> = {
  short: { max: 4 * 60 },
  medium: { min: 4 * 60, max: 20 * 60 },
  long: { min: 20 * 60 },
};

/** Look-back window in milliseconds for the upload date filter. */
export const SEARCH_DATE_WINDOWS_MS: Readonly<Record<SearchDateFilter, number>> = {
  hour: 60 * 60 * 1000,
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export interface SearchQuery {
  q?: string;
  type?: SearchEntityType;
  duration?: SearchDurationFilter;
  /** Videos only: Shorts or (long-form) videos, by the shared rule (video-format.ts). */
  format?: VideoFormat;
  date?: SearchDateFilter;
  language?: string;
  category?: string;
  verified?: boolean;
  channelId?: string;
  sort?: SearchSort;
  cursor?: string;
  limit?: number;
}

export interface SearchChannelInfo {
  id: string;
  name?: string;
  avatarUrl?: string;
  isVerified: boolean;
}

export type SearchResultItem =
  | { type: 'video'; id: string; score: number; video: SearchVideoPayload; channel?: SearchChannelInfo }
  | { type: 'channel'; id: string; score: number; channel: SearchChannelPayload }
  | { type: 'playlist'; id: string; score: number; playlist: SearchPlaylistPayload; channel?: SearchChannelInfo }
  | { type: 'post'; id: string; score: number; post: SearchPostPayload; channel?: SearchChannelInfo };

export interface SearchResponse {
  success: boolean;
  query: string;
  type: SearchEntityType | 'all';
  results: SearchResultItem[];
  nextCursor: string | null;
  hasMore: boolean;
  /** True when no result matched every word and results match any word instead. */
  relaxed: boolean;
  searchTime: number;
}

export interface ExploreCategory {
  value: string;
  label: { en: string; ar: string };
  count: number;
}

/**
 * A seasonal rail configured in global settings (`explore/seasonal.json`).
 * Shown only between `startsAt` and `endsAt`; no dates are built into the code.
 */
export interface SeasonalRailConfig {
  id: string;
  enabled?: boolean;
  title: { en: string; ar: string };
  subtitle?: { en?: string; ar?: string };
  startsAt: string;
  endsAt: string;
  /** Items come from the search index: category, tag/keyword query, or both. */
  category?: string;
  query?: string;
  limit?: number;
}

export interface SeasonalRail {
  id: string;
  title: { en: string; ar: string };
  subtitle?: { en?: string; ar?: string };
  endsAt: string;
  videos: SearchVideoPayload[];
}

export interface ExploreResponse {
  success: boolean;
  categories: ExploreCategory[];
  newChannels: SearchChannelPayload[];
  seasonal: SeasonalRail[];
}
