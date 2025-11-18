'use server';

import {
  ChannelSection,
  ChannelSectionCreateRequest,
  ChannelSectionUpdateRequest,
  ChannelSectionReorderRequest,
} from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';

const baseUrl = getApiUrl();

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * List all sections for a channel
 * GET /api/channels/{channelId}/sections
 */
export async function listChannelSections(
  channelId: string,
  authToken?: string
): Promise<ApiResponse<ChannelSection[]>> {
  try {
    const response = await fetch(`${baseUrl}/api/channels/${channelId}/sections`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching sections: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      data: data.sections || [],
    };
  } catch (error) {
    console.error('listChannelSections error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a single section
 * GET /api/channels/{channelId}/sections/{sectionId}
 */
export async function getChannelSection(
  channelId: string,
  sectionId: string,
  authToken?: string
): Promise<ApiResponse<ChannelSection>> {
  try {
    const response = await fetch(
      `${baseUrl}/api/channels/${channelId}/sections/${sectionId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching section: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: true,
      data: data.section,
    };
  } catch (error) {
    console.error('getChannelSection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a new section
 * POST /api/channels/{channelId}/sections
 */
export async function createChannelSection(
  channelId: string,
  data: ChannelSectionCreateRequest,
  authToken: string
): Promise<ApiResponse<ChannelSection>> {
  try {
    const response = await fetch(`${baseUrl}/api/channels/${channelId}/sections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error creating section: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      success: true,
      data: result.section,
    };
  } catch (error) {
    console.error('createChannelSection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update an existing section
 * PUT /api/channels/{channelId}/sections/{sectionId}
 */
export async function updateChannelSection(
  channelId: string,
  sectionId: string,
  data: ChannelSectionUpdateRequest,
  authToken: string
): Promise<ApiResponse<ChannelSection>> {
  try {
    const response = await fetch(
      `${baseUrl}/api/channels/${channelId}/sections/${sectionId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error updating section: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      success: true,
      data: result.section,
    };
  } catch (error) {
    console.error('updateChannelSection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete a section
 * DELETE /api/channels/{channelId}/sections/{sectionId}
 */
export async function deleteChannelSection(
  channelId: string,
  sectionId: string,
  authToken: string
): Promise<ApiResponse<void>> {
  try {
    const response = await fetch(
      `${baseUrl}/api/channels/${channelId}/sections/${sectionId}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error deleting section: ${response.statusText}`);
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error('deleteChannelSection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Reorder sections
 * POST /api/channels/{channelId}/sections/reorder
 */
export async function reorderChannelSections(
  channelId: string,
  data: ChannelSectionReorderRequest,
  authToken: string
): Promise<ApiResponse<ChannelSection[]>> {
  try {
    const response = await fetch(
      `${baseUrl}/api/channels/${channelId}/sections/reorder`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error reordering sections: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      success: true,
      data: result.sections,
    };
  } catch (error) {
    console.error('reorderChannelSections error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
