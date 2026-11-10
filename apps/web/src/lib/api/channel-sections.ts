'use server';

import {
  ChannelSection,
  ChannelSectionCreateInput,
  ChannelSectionUpdateInput,
  ChannelSectionReorderInput,
} from '@al-ummah/shared-types';
import { apiRequestServer, apiRequestServerResult, buildApiUrl, type ApiResult } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger';

/**
 * List all sections for a channel
 * GET /api/channels/{channelId}/sections
 */
export async function listChannelSections(
  channelId: string
): Promise<ChannelSection[] | null> {
  try {
    logger.info('listChannelSections: Starting request', { channelId });

    const response = await apiRequestServer<{
      success: boolean;
      result: {
        sections: ChannelSection[];
        pagination: { cursor: string; hasMore: boolean; total: number };
      }
    }>({
      method: 'GET',
      url: buildApiUrl(`/api/channels/${channelId}/sections`),
      functionName: 'listChannelSections'
    }, getServerAuthContext, false);

    logger.info('listChannelSections: Response received', {
      channelId,
      hasResponse: !!response,
      responseType: typeof response,
      success: response?.success,
      hasResult: !!response?.result,
      hasSections: !!(response?.result?.sections),
      sectionsCount: response?.result?.sections?.length || 0
    });

    if (!response || !response.success || !response.result) {
      logger.warn('listChannelSections: Invalid response', { channelId, response });
      return null;
    }

    // Return just the sections array for simpler serialization
    return response.result.sections;
  } catch (error) {
    logger.error('listChannelSections: Exception', { channelId, error });
    throw error; // Re-throw so the caller can handle it
  }
}

/**
 * List all sections for a channel with populated content
 * GET /api/channels/{channelId}/sections/populated
 */
export async function listChannelSectionsPopulated(
  channelId: string
): Promise<ChannelSection[] | null> {
  try {
    logger.info('listChannelSectionsPopulated: Starting request', { channelId });

    const response = await apiRequestServer<{
      success: boolean;
      result: {
        sections: ChannelSection[];
        pagination: { cursor: string; hasMore: boolean; total: number };
      }
    }>({
      method: 'GET',
      url: buildApiUrl(`/api/channels/${channelId}/sections/populated`),
      functionName: 'listChannelSectionsPopulated'
    }, getServerAuthContext, false);

    logger.info('listChannelSectionsPopulated: Response received', {
      channelId,
      hasResponse: !!response,
      responseType: typeof response,
      success: response?.success,
      hasResult: !!response?.result,
      hasSections: !!(response?.result?.sections),
      sectionsCount: response?.result?.sections?.length || 0
    });

    if (!response || !response.success || !response.result) {
      logger.warn('listChannelSectionsPopulated: Invalid response', { channelId, response });
      return null;
    }

    // Return just the sections array for simpler serialization
    return response.result.sections;
  } catch (error) {
    logger.error('listChannelSectionsPopulated: Exception', { channelId, error });
    throw error; // Re-throw so the caller can handle it
  }
}

/**
 * Get a single section
 * GET /api/channels/{channelId}/sections/{sectionId}
 */
export async function getChannelSection(
  channelId: string,
  sectionId: string
): Promise<{ section: ChannelSection } | null> {
  const response = await apiRequestServer<{
    success: boolean;
    result: { section: ChannelSection };
  }>({
    method: 'GET',
    url: buildApiUrl(`/api/channels/${channelId}/sections/${sectionId}`),
    functionName: 'getChannelSection'
  }, getServerAuthContext, false);

  if (!response || !response.success) {
    return null;
  }

  return { section: response.result.section };
}

/**
 * Outcome of a section write: the saved section, or the API's stable error
 * code (docs/specs/CHANNEL-SECTIONS.md §8.2) for the page to localize.
 */
export type SectionWriteResult =
  | { ok: true; section: ChannelSection }
  | { ok: false; code: string };

function toWriteResult(result: ApiResult<{ success: boolean; result?: { section: ChannelSection } }>): SectionWriteResult {
  if (result.data?.success && result.data.result?.section) {
    return { ok: true, section: result.data.result.section };
  }
  const body = result.errorBody as { code?: unknown } | undefined;
  const code = typeof body?.code === 'string' ? body.code : result.status === 403 ? 'forbidden' : 'generic';
  logger.warn('Channel section write rejected', { status: result.status, code });
  return { ok: false, code };
}

/**
 * Create a new section
 * POST /api/channels/{channelId}/sections
 */
export async function createChannelSection(
  channelId: string,
  data: ChannelSectionCreateInput
): Promise<SectionWriteResult> {
  return toWriteResult(await apiRequestServerResult<{ success: boolean; result?: { section: ChannelSection } }>({
    method: 'POST',
    url: buildApiUrl(`/api/channels/${channelId}/sections`),
    body: data,
    functionName: 'createChannelSection'
  }, getServerAuthContext, true));
}

/**
 * Update an existing section
 * PUT /api/channels/{channelId}/sections/{sectionId}
 */
export async function updateChannelSection(
  channelId: string,
  sectionId: string,
  data: ChannelSectionUpdateInput
): Promise<SectionWriteResult> {
  return toWriteResult(await apiRequestServerResult<{ success: boolean; result?: { section: ChannelSection } }>({
    method: 'PUT',
    url: buildApiUrl(`/api/channels/${channelId}/sections/${sectionId}`),
    body: data,
    functionName: 'updateChannelSection'
  }, getServerAuthContext, true));
}

/**
 * Delete a section
 * DELETE /api/channels/{channelId}/sections/{sectionId}
 */
export async function deleteChannelSection(
  channelId: string,
  sectionId: string
): Promise<{ success: boolean } | null> {
  const response = await apiRequestServer<{
    success: boolean;
    result?: { message: string };
  }>({
    method: 'DELETE',
    url: buildApiUrl(`/api/channels/${channelId}/sections/${sectionId}`),
    functionName: 'deleteChannelSection'
  }, getServerAuthContext, true);

  if (!response || !response.success) {
    return null;
  }

  return { success: true };
}

/**
 * Reorder sections
 * PATCH /api/channels/{channelId}/sections/reorder
 */
export async function reorderChannelSections(
  channelId: string,
  data: ChannelSectionReorderInput
): Promise<ChannelSection[] | null> {
  const response = await apiRequestServer<{
    success: boolean;
    result: { sections: ChannelSection[] };
  }>({
    method: 'PATCH',
    url: buildApiUrl(`/api/channels/${channelId}/sections/reorder`),
    body: data,
    functionName: 'reorderChannelSections'
  }, getServerAuthContext, true);

  if (!response || !response.success || !response.result) {
    return null;
  }

  return response.result.sections;
}
