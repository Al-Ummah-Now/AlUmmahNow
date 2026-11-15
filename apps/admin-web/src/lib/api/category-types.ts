/** admin-api /api/video-categories shapes (apps/admin-api/src/routers/videoCategories.router.ts). */
export interface VideoCategoryAdminView {
  value: string;
  label: { en: string; ar: string };
  hint: string;
  position: number;
  retired: boolean;
  videoCount: number;
  updatedAt: number | null;
}

export interface VideoCategoryAdminList {
  categories: VideoCategoryAdminView[];
  limits: { label: number; hint: number; max: number };
  canManage: boolean;
}

export interface VideoCategoryInput {
  value?: string;
  labelEn: string;
  labelAr: string;
  hint?: string;
}

export interface VideoCategoryPatch {
  labelEn?: string;
  labelAr?: string;
  hint?: string;
  retired?: boolean;
}

export interface VideoCategoryHistoryEntry {
  id: string;
  value: string;
  previous: Record<string, unknown> | null;
  change: { action: 'create' | 'update' | 'retire' | 'restore' | 'reorder'; details?: Record<string, unknown> };
  actorId: string;
  actorName: string | null;
  createdAt: string;
}
