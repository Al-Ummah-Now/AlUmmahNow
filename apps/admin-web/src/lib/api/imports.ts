'use server';

/**
 * The Imports view (wiki TOOLS-ADMIN TA-8) over admin-api /api/admin/import/* (imports:manage): Admin
 * Tools batches, a page of a batch's files with what became of each, and the file a video came from.
 * Reads throw; the pages show an error.
 */
import type { AdminImportBatch, AdminImportItem, AdminImportItemStatus, ImportItemState } from '@al-ummah/shared-types';
import { fetchAdmin } from './request';

const BASE = '/api/admin/import';
const enc = encodeURIComponent;

export interface ImportBatchPage {
  batch: AdminImportBatch;
  items: AdminImportItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<ImportItemState, number>>;
  state?: ImportItemState;
  /** Per item id; null when api-videos could not be read */
  statuses: Record<string, AdminImportItemStatus> | null;
}

export async function listImportBatches(channelId?: string): Promise<AdminImportBatch[]> {
  return (await fetchAdmin<{ batches: AdminImportBatch[] }>(`${BASE}/batches${channelId ? `?channelId=${enc(channelId)}` : ''}`)).batches;
}

export async function getImportBatchPage(id: string, page: number, state?: ImportItemState): Promise<ImportBatchPage> {
  return fetchAdmin(`${BASE}/batches/${enc(id)}?page=${page}${state ? `&state=${state}` : ''}`);
}

/** The file a video was imported from and its page in the batch; null when none was. */
export async function findImportByVideo(videoId: string): Promise<{ item: AdminImportItem; page: number } | null> {
  try {
    return await fetchAdmin(`${BASE}/items/by-video/${enc(videoId)}`);
  } catch (error) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}
