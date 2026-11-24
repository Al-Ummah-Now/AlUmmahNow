import type {
  AdminSuggestion,
  KidsAgeBand,
  KidsCatalogItem,
  KidsCatalogStatus,
  KidsReadiness,
  KidsReviewRequest,
  KidsReviewStatus,
  KidsTargetType,
  KidsTopic,
} from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { AdminApiError } from './errors';

export interface KidsCatalogListResponse {
  items: KidsCatalogItem[];
  hasMore: boolean;
  nextCursor: string | null;
  canDelete: boolean;
}

export interface KidsReviewListResponse {
  items: KidsReviewRequest[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface KidsStaffChannelSummary {
  id: string;
  name: string | null;
}

export interface KidsPolicyResponse {
  decisions: Record<string, string>;
  staffChannelIds: string[];
  staffChannels?: KidsStaffChannelSummary[];
  legalApproved: boolean;
  legalApprovedBy: string | null;
  legalApprovedByName?: string | null;
  legalApprovedAt: string | null;
  updatedAt: string | null;
  readiness: KidsReadiness;
  canEdit: boolean;
}

export interface CreateKidsCatalogInput {
  targetType: KidsTargetType;
  targetId: string;
  ageBand?: KidsAgeBand;
  topics?: KidsTopic[];
  position?: number;
}

export interface UpdateKidsCatalogPatch {
  ageBand?: KidsAgeBand;
  status?: 'approved' | 'revoked';
  topics?: KidsTopic[];
  position?: number;
}

export interface DecideKidsReviewInput {
  decision: 'approved' | 'declined';
  reason?: string;
  ageBand?: KidsAgeBand;
  topics?: KidsTopic[];
}

export interface UpdateKidsPolicyInput {
  decisions?: Record<string, string | null>;
  staffChannelIds?: string[];
  legalApproved?: boolean;
  expectedUpdatedAt?: string | null;
}

export interface KidsAdminActions {
  listCatalog: (params?: { status?: string; ageBand?: string; targetType?: string; limit?: number; cursor?: string }) => Promise<KidsCatalogListResponse>;
  createCatalog: (input: CreateKidsCatalogInput) => Promise<ActionResult<{ item: KidsCatalogItem }>>;
  updateCatalog: (id: string, patch: UpdateKidsCatalogPatch) => Promise<ActionResult<{ item: KidsCatalogItem }>>;
  deleteCatalog: (id: string, reason?: string) => Promise<ActionResult<{ item: KidsCatalogItem }>>;
  restoreCatalog: (id: string) => Promise<ActionResult<{ item: KidsCatalogItem }>>;
  searchStaffPlaylists: (query: string, cursor: string | null) => Promise<{ items: AdminSuggestion[]; next: string | null }>;
  listReviews: (params?: { status?: KidsReviewStatus; limit?: number; cursor?: string }) => Promise<KidsReviewListResponse>;
  decideReview: (id: string, input: DecideKidsReviewInput) => Promise<ActionResult<{ request: KidsReviewRequest }>>;
  updatePolicy: (input: UpdateKidsPolicyInput) => Promise<ActionResult<Omit<KidsPolicyResponse, 'canEdit'>>>;
}

export function isKidsTableMissing(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === 'kids_tables_missing';
}

export type KidsPageTab = 'catalog' | 'reviews' | 'policy';

export type {
  AdminSuggestion,
  KidsAgeBand,
  KidsCatalogItem,
  KidsCatalogStatus,
  KidsReadiness,
  KidsReviewRequest,
  KidsReviewStatus,
  KidsTargetType,
  KidsTopic,
};
