/**
 * Upload Defaults Endpoints
 * List and create upload templates
 */

import { Str, Bool, Num } from 'chanfana';
import { z } from 'zod';
import { isDefaultTemplate, pointerCache, setDefaultTemplate } from '../../lib/uploadDefaultPointer';
import R2Repository from '../../lib/r2Repo';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { AuthenticatedRoute, AppContext } from '../../base';
import {
  UploadTemplate,
  CreateTemplateRequest,
  TemplateListResponse,
} from '@al-ummah/shared-types';
import {
  CreateTemplateRequestSchema,
  validateCreateTemplateRequest,
  validateTemplateSize,
} from '../../lib/templates/validator';
import { logger } from '../../lib/logger';

/**
 * List Upload Templates Endpoint
 * GET /api/upload-defaults
 */
export class ListUploadDefaultsEndpoint extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'List Upload Templates',
      description:
        'Get all upload templates for the authenticated user. Templates can be filtered by channel and active status.',
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        query: z.object({
          limit: z.number().min(1).max(50).default(20).describe('Maximum number of templates to return'),
          cursor: Str({
            description: 'Pagination cursor from previous response',
          }).optional(),
          includeInactive: z.boolean().default(false).optional().describe('Include inactive templates'),
          channelId: Str({
            description: 'Filter by channel ID',
          }).optional(),
        }),
      },
      responses: {
        '200': {
          description: 'List of upload templates',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: true }),
                result: z.object({
                  templates: z.array(z.any()),
                  defaultTemplateId: Str().optional(),
                  cursor: Str().optional(),
                }),
              }),
            },
          },
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
              }),
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c: AppContext) {
    try {
      const userId = this.getUserId(c);

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { limit, cursor, includeInactive = false, channelId } = data.query;

      // Get bucket
      const bucket = c.env['upload-defaults'];
      const repo = new R2Repository<UploadTemplate>(bucket);

      // Build prefix for listing
      // Format: {userId}/ or {userId}/{channelId}/
      const prefix = channelId ? `${userId}/${channelId}/` : `${userId}/`;

      // List templates with pagination
      const result = await bucket.list({
        limit: limit || 20,
        cursor: cursor || undefined,
        prefix,
      });

      logger.debug('Upload defaults query:', { userId, channelId, prefix, objectCount: result.objects.length });

      // Fetch and parse templates
      const templates: UploadTemplate[] = [];

      for (const object of result.objects) {
        if (!object.key) continue;

        const template = await repo.getObject(object.key);
        if (template) {
          // Filter inactive if needed
          if (!includeInactive && template.isActive === false) {
            continue;
          }

          templates.push(template);
        }
      }

      // Default per scope from its pointer document (SCALABILITY-AUDIT AV-20);
      // scopes without one still use the templates' own flags
      const pointerFor = pointerCache(bucket, userId);
      for (const template of templates) {
        template.isDefault = isDefaultTemplate(template, await pointerFor(template.channelId));
      }
      const queriedPointer = await pointerFor(channelId);
      const defaultTemplate = queriedPointer
        ? templates.find((t) => t.id === queriedPointer.defaultTemplateId)
        : templates.find((t) => t.isDefault);

      const response = {
        success: true,
        result: {
          templates,
          defaultTemplateId: defaultTemplate?.id,
          cursor: result.truncated ? result.cursor : undefined,
        },
      };

      logger.debug('Upload defaults response:', {
        templatesCount: templates.length,
        hasDefault: !!defaultTemplate,
        hasCursor: !!response.result.cursor
      });

      return c.json(response);
    } catch (error) {
      logger.error('List upload defaults error:', error);
      logger.error('Bucket binding:', c.env['upload-defaults'] ? 'exists' : 'undefined');
      logger.error('Error details:', error instanceof Error ? error.message : String(error));
      return c.json(
        {
          success: false,
          error: 'Failed to list upload templates',
          debug: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}

/**
 * Create Upload Template Endpoint
 * POST /api/upload-defaults
 */
export class CreateUploadDefaultEndpoint extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'Create Upload Template',
      description:
        'Create a new upload template for the authenticated user. Templates can store pre-filled metadata for video uploads.',
      request: {
        body: {
          content: {
            'application/json': {
              schema: CreateTemplateRequestSchema,
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Template created successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: true }),
                result: z.object({
                  template: z.any(),
                }),
              }),
            },
          },
        },
        '400': {
          description: 'Invalid request data',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
                errors: z.array(
                  z.object({
                    field: Str(),
                    message: Str(),
                  })
                ).optional(),
              }),
            },
          },
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
              }),
            },
          },
        },
      },
    },
    'required'
  );

  async handle(c: AppContext) {
    try {
      const userId = this.getUserId(c);

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const requestData = data.body;

      // Validate request
      const validation = validateCreateTemplateRequest(requestData);
      if (!validation.isValid) {
        return c.json(
          {
            success: false,
            error: 'Validation failed',
            errors: validation.errors,
          },
          400
        );
      }

      // Check template size
      const sizeValidation = validateTemplateSize(requestData.template);
      if (!sizeValidation.isValid) {
        return c.json(
          {
            success: false,
            error: `Template too large (${sizeValidation.size} bytes). Maximum size: ${sizeValidation.maxSize} bytes`,
          },
          400
        );
      }

      // Get bucket
      const bucket = c.env['upload-defaults'];
      const repo = new R2Repository<UploadTemplate>(bucket);

      // Generate template ID
      const templateId = crypto.randomUUID();

      // Create template object
      const now = new Date().toISOString();
      const template: UploadTemplate = {
        id: templateId,
        userId,
        channelId: requestData.channelId,
        name: requestData.name,
        nameLocalized: requestData.nameLocalized,
        description: requestData.description,
        isDefault: requestData.isDefault || false,
        isActive: true,
        template: requestData.template,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      };

      // Build key
      // Format: {userId}/{templateId} or {userId}/{channelId}/{templateId}
      const key = requestData.channelId
        ? `${userId}/${requestData.channelId}/${templateId}`
        : `${userId}/${templateId}`;

      // Save to R2
      await repo.putObject(key, template);

      // Becoming the default replaces the scope's previous default in one
      // conditional write (SCALABILITY-AUDIT AV-20)
      if (template.isDefault) {
        await setDefaultTemplate(bucket, userId, template);
      }

      return c.json(
        {
          success: true,
          result: {
            template,
          },
        },
        201
      );
    } catch (error) {
      logger.error('Create upload default error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to create upload template',
        },
        500
      );
    }
  }
}
