/**
 * Discovery ranking, shared by api-videos (the job and the rails), admin-api (curation) and the
 * admin and web apps (wiki E07 "Discovery ranking").
 */
import type { AdminJob } from './admin-content';

/** Home page rails, in their default order; the admin orders and switches them. */
export const DISCOVERY_HOME_RAILS = ['featured', 'trending', 'new', 'popular', 'categories'] as const;
export type DiscoveryHomeRail = (typeof DISCOVERY_HOME_RAILS)[number];

/**
 * Where an admin can pin a video or channel (discovery_pins.rail): the home rails, Explore's list,
 * or one category's lists ('category:<value>').
 */
export const DISCOVERY_PIN_RAILS = ['featured', 'trending', 'popular', 'new', 'explore'] as const;
export type DiscoveryPinRail = (typeof DISCOVERY_PIN_RAILS)[number] | `category:${string}`;

export const DISCOVERY_PIN_KINDS = ['video', 'channel'] as const;
export type DiscoveryPinKind = (typeof DISCOVERY_PIN_KINDS)[number];

/** Highest pin position (a rail page shows 12-24 videos; pins beyond that would not be seen). */
export const DISCOVERY_MAX_PIN_POSITION = 24;
export const DISCOVERY_NOTE_MAX = 200;

/** What a rail shows now: a rail without enough viewer signal says so (Trending → New this week). */
export const DISCOVERY_RAIL_LABELS = [
  'trending_today',
  'trending_this_week',
  'trending_this_month',
  'popular',
  'new_today',
  'new_this_week',
  'new_this_month',
  'latest',
  'featured',
  'top',
] as const;
export type DiscoveryRailLabel = (typeof DISCOVERY_RAIL_LABELS)[number];

export function isDiscoveryPinRail(value: unknown): value is DiscoveryPinRail {
  if (typeof value !== 'string') return false;
  if ((DISCOVERY_PIN_RAILS as readonly string[]).includes(value)) return true;
  return /^category:[a-z0-9_-]{1,64}$/.test(value);
}

export interface DiscoveryPinView {
  id: string;
  rail: DiscoveryPinRail;
  kind: DiscoveryPinKind;
  targetId: string;
  /** Title (video) or name (channel) from the search index; null when it is no longer there */
  title: string | null;
  titleLocalized?: { en?: string; ar?: string } | null;
  thumbnailUrl?: string | null;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  /** 'active' | 'scheduled' (starts later) | 'ended' */
  state: 'active' | 'scheduled' | 'ended';
}

export interface DiscoveryExclusionView {
  kind: DiscoveryPinKind;
  targetId: string;
  title: string | null;
  titleLocalized?: { en?: string; ar?: string } | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

export interface DiscoveryHomeRailView {
  rail: DiscoveryHomeRail;
  enabled: boolean;
}

export interface DiscoveryRailSummary {
  rail: string;
  scope: string;
  mode: string;
  label: DiscoveryRailLabel | string;
  items: number;
  signalItems: number;
  computedAt: string;
}

export interface DiscoveryRunSummary {
  at: string;
  videos: number;
  eligible: number;
  excluded: number;
  engaged: number;
  rails: number;
  written: number;
  unchanged: number;
  removed: number;
  modes: Record<string, string>;
  ms: number;
}

export interface DiscoveryAdminState {
  pins: DiscoveryPinView[];
  exclusions: DiscoveryExclusionView[];
  homeRails: DiscoveryHomeRailView[];
  categories: Array<{ value: string; label: { en: string; ar: string } }>;
  status: {
    lastRun: DiscoveryRunSummary | null;
    rails: DiscoveryRailSummary[];
    jobs: AdminJob[];
  } | null;
  canManage: boolean;
}

export interface DiscoveryPreviewItem {
  position: number;
  reason: string;
  score: number;
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  thumbnailUrl?: string;
  channelId?: string;
  channelName?: string;
  channelNameLocalized?: Record<string, string>;
}
