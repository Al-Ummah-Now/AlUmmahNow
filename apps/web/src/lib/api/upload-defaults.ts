'use server';

/**
 * Upload Defaults / Templates API Client
 *
 * Client functions for managing upload template defaults.
 * Provides CRUD operations for user templates and variable processing.
 */

import {
  UploadTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  TemplateListResponse,
} from '@al-ummah/shared-types';
import { apiRequestServer, buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth-v2';

/**
 * List all templates for the current user
 * GET /api/upload-defaults
 */
export async function listTemplates(): Promise<TemplateListResponse | null> {
  return apiRequestServer<TemplateListResponse>(
    {
      method: 'GET',
      url: buildApiUrl('/api/upload-defaults'),
      functionName: 'listTemplates',
    },
    getServerAuthContext,
    true
  );
}

/**
 * Get a single template by ID
 * GET /api/upload-defaults/:id
 */
export async function getTemplate(templateId: string): Promise<{ template: UploadTemplate } | null> {
  return apiRequestServer<{ template: UploadTemplate }>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/upload-defaults/${templateId}`),
      functionName: 'getTemplate',
    },
    getServerAuthContext,
    true
  );
}

/**
 * Create a new template
 * POST /api/upload-defaults
 */
export async function createTemplate(
  template: CreateTemplateRequest
): Promise<{ template: UploadTemplate } | null> {
  return apiRequestServer<{ template: UploadTemplate }>(
    {
      method: 'POST',
      url: buildApiUrl('/api/upload-defaults'),
      body: template,
      functionName: 'createTemplate',
    },
    getServerAuthContext,
    true
  );
}

/**
 * Update an existing template
 * PUT /api/upload-defaults/:id
 */
export async function updateTemplate(
  templateId: string,
  updates: UpdateTemplateRequest
): Promise<{ template: UploadTemplate } | null> {
  return apiRequestServer<{ template: UploadTemplate }>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/upload-defaults/${templateId}`),
      body: updates,
      functionName: 'updateTemplate',
    },
    getServerAuthContext,
    true
  );
}

/**
 * Delete a template
 * DELETE /api/upload-defaults/:id
 */
export async function deleteTemplate(templateId: string): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>(
    {
      method: 'DELETE',
      url: buildApiUrl(`/api/upload-defaults/${templateId}`),
      functionName: 'deleteTemplate',
    },
    getServerAuthContext,
    true
  );
}

/**
 * Set a template as the default
 * PUT /api/upload-defaults/:id/default (the API has no POST route; POST returned 404)
 */
export async function setDefaultTemplate(templateId: string): Promise<{ success: boolean } | null> {
  return apiRequestServer<{ success: boolean }>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/upload-defaults/${templateId}/default`),
      functionName: 'setDefaultTemplate',
    },
    getServerAuthContext,
    true
  );
}
