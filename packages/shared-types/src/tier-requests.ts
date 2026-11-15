/**
 * Tier requests (wiki AUN-TIER-REQUESTS): the /upgrade page.
 *
 * During the beta nobody pays: a signed-in user REQUESTS a tier the admin
 * marked as requestable, with their name and a few lines about themselves.
 * The videos admin approves (assigns the tier, audited) or declines (with an
 * optional reason). The user sees the status on /upgrade and gets an in-app
 * notification and an email, sent from a queue with retries; a send that
 * gives up flags the admin's Errors page with a Retry.
 *
 * Videos-side data (search D1 `tier_requests`), never Auth RBAC.
 */
import type { CreatorTier } from './creator-tiers';

export const TIER_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'withdrawn'] as const;
export type TierRequestStatus = (typeof TIER_REQUEST_STATUSES)[number];

/** Text limits of a request (characters, after trimming). */
export const TIER_REQUEST_LIMITS = {
  name: { min: 2, max: 100 },
  about: { min: 20, max: 1000 },
  declineReason: { max: 500 },
} as const;

/** Most requests one user may send in 30 days (any status). */
export const TIER_REQUESTS_PER_30_DAYS = 5;

/** Error codes of POST /api/me/tier-requests (the web maps them to en/ar copy). */
export const TIER_REQUEST_ERRORS = {
  /** 409: the user already has a pending request */
  alreadyPending: 'tier_request_pending',
  /** 409: the user already holds that tier */
  alreadyHeld: 'tier_already_held',
  /** 404: no requestable tier with that id */
  tierNotRequestable: 'tier_not_requestable',
  /** 429: TIER_REQUESTS_PER_30_DAYS reached */
  tooMany: 'tier_requests_limit',
  /** 400: name or about outside TIER_REQUEST_LIMITS */
  invalid: 'invalid_tier_request',
  /** 403: the Turnstile check failed */
  turnstile: 'turnstile_failed',
  /** 409 (admin): the request was already decided or withdrawn */
  notPending: 'tier_request_not_pending',
} as const;

/** A tier as /upgrade shows it: what it includes, never a price. */
export interface PublicTier {
  id: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  unlimited: boolean;
  uploads: boolean;
  channels: boolean;
  /** Channels the holder may own; null = no limit */
  maxChannels: number | null;
  pages: boolean;
  captionMinutesMonth: number;
  /** Upload sessions per day; null = no limit (unlimited) */
  uploadsPerDay: number | null;
  requestable: boolean;
}

export function toPublicTier(tier: CreatorTier): PublicTier {
  return {
    id: tier.id,
    name: tier.name,
    nameAr: tier.nameAr,
    description: tier.description,
    descriptionAr: tier.descriptionAr,
    unlimited: tier.unlimited,
    uploads: tier.unlimited || tier.uploads,
    channels: tier.unlimited || tier.channels,
    maxChannels: tier.unlimited ? null : tier.maxChannels,
    pages: tier.unlimited || tier.pages,
    captionMinutesMonth: tier.unlimited ? 0 : tier.captionMinutesMonth,
    uploadsPerDay: tier.unlimited ? null : tier.perDay,
    requestable: tier.requestable,
  };
}

/** One request, as its author and the admin see it. */
export interface TierRequest {
  id: string;
  userId: string;
  tierId: string;
  /** The tier's name when the request was made (the tier may be renamed or deleted later) */
  tierName: string;
  /** The tier the user held when they asked */
  fromTierId: string;
  name: string;
  about: string;
  status: TierRequestStatus;
  /** Shown to the user when declined (optional) */
  declineReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

/** GET /api/tiers/upgrade: what /upgrade shows (public; `current*` and `request` only when signed in). */
export interface UpgradeOverview {
  /** Requestable tiers plus the viewer's own tier, in sortOrder */
  tiers: PublicTier[];
  /** The signed-in user's tier id (Member when unassigned); null when signed out */
  currentTierId: string | null;
  /** The user's latest request (any status); null when none or signed out */
  request: TierRequest | null;
  /** Turnstile site key when the env checks Turnstile on requests; null = no widget */
  turnstileSiteKey: string | null;
}

/** POST /api/me/tier-requests body. */
export interface TierRequestInput {
  tierId: string;
  name: string;
  about: string;
  turnstileToken?: string | null;
}

/** A row of the admin's Tier requests queue. */
export interface AdminTierRequestRow extends TierRequest {
  displayName: string | null;
  userName: string | null;
  avatarUrl: string | null;
  /** The tier the user holds now (Member when unassigned) */
  currentTierId: string;
  currentTierName: string;
  /** How the decision email went: queued, sent, sunk, disabled, no_address, failed; null before a decision */
  emailStatus: string | null;
}

export const ADMIN_TIER_REQUEST_FILTERS = ['pending', 'approved', 'declined', 'all'] as const;
export type AdminTierRequestFilter = (typeof ADMIN_TIER_REQUEST_FILTERS)[number];

export interface AdminTierRequestsPage {
  items: AdminTierRequestRow[];
  /** Opaque keyset cursor for the next page; null at the end */
  next: string | null;
  /** Pending requests in total (the nav badge and the tab count) */
  pending: number;
}
