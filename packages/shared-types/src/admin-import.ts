/**
 * The Imports view of the videos admin (wiki TOOLS-ADMIN TA-8): import batches made by Admin Tools,
 * their files, and what became of each file on the server — the video, the sidecars the attach job
 * puts on it, and its captions per language. admin-api /api/admin/import/* (imports:manage).
 */
import type { AdminJobStatus } from './admin-content';
import type { CaptionJobError } from './caption-jobs';
import type { VideoProcessingStatus } from './video';

/** A file's state in its batch: the app opened its upload, sent all of it, or gave up on it. */
export const IMPORT_ITEM_STATES = ['initiated', 'uploaded', 'failed'] as const;
export type ImportItemState = (typeof IMPORT_ITEM_STATES)[number];

export interface AdminImportBatch {
  id: string;
  channelId: string;
  name: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Files per state (the list only) */
  counts?: Partial<Record<ImportItemState, number>>;
  /** The channel's name, when it could be read (the list and the batch) */
  channelName?: string | null;
}

export interface AdminImportItem {
  id: string;
  batchId: string;
  channelId: string;
  sha256: string;
  fileName: string;
  fileSize: number;
  videoId: string | null;
  state: ImportItemState;
  /** Why the app gave up on the file (its own words, from POST /items/:id/failed) */
  error: string | null;
  attachJobId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** The parts of a file's sidecars, in the order the attach job puts them on. */
export const IMPORT_SIDECAR_PARTS = ['captions', 'playlist', 'chapters', 'thumbnail', 'schedule'] as const;
export type ImportSidecarPart = (typeof IMPORT_SIDECAR_PARTS)[number];

/**
 * A caption language of an imported video:
 *   working    a caption job is drafting or translating it
 *   failed     its last caption job failed (`error`)
 *   published  a track is live (`origin`: uploaded with the file, or published from a machine draft)
 *   draft      a machine draft waits for a person to publish it
 */
export const IMPORT_CAPTION_STATES = ['working', 'failed', 'published', 'draft'] as const;
export type ImportCaptionState = (typeof IMPORT_CAPTION_STATES)[number];
export interface ImportCaptionStatus {
  language: string;
  state: ImportCaptionState;
  /** transcribe or translate: the caption job behind a working, failed or draft language */
  job?: 'transcribe' | 'translate';
  error?: CaptionJobError;
  origin?: 'upload' | 'machine' | 'machine_edited';
}

/** What the server did with one imported file (api-videos POST /admin/import/status). */
export interface AdminImportItemStatus {
  videoId: string;
  /** null: the video is gone */
  video: { title: string; processingStatus: VideoProcessingStatus | null; isDeleted: boolean } | null;
  /** The sidecars' attach job; null when the file came without sidecars */
  attach: {
    jobId: string;
    status: AdminJobStatus;
    attempts: number;
    maxAttempts: number;
    nextRunAt: string | null;
    lastError: string | null;
    /** What came with the file (older jobs: unknown, so only `done` is shown) */
    sent: ImportSidecarPart[] | null;
    done: ImportSidecarPart[];
    /** Sidecars skipped as unusable (the job's own words) */
    warnings: string[];
  } | null;
  captions: ImportCaptionStatus[];
}

/** Files a batch page shows at once (and the most the status lookup takes). */
export const ADMIN_IMPORT_PAGE_SIZE = 50;
