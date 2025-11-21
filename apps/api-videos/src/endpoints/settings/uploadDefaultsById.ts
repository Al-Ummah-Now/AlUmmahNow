/**
 * Upload Defaults By ID Endpoints
 * Get, update, and delete individual upload templates
 */

import { OpenAPIRoute, Str, Bool } from 'chanfana';
import { z } from 'zod';
import R2Repository from '../../lib/r2Repo';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { getAuthContext } from '../../middleware/auth';
import { UploadTemplate, UpdateTemplateRequest } from '@al-ummah/shared-types';
import {
  UpdateTemplateRequestSchema,
  validateUpdateTemplateRequest,
  validateTemplateSize,
} from '../../lib/templates/validator';

/**
 * Get Upload Template Endpoint
 * GET /api/upload-defaults/:id
 */
export class GetUploadDefaultEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'Get Upload Template',
      description:
        'Get a specific upload template by ID. User must own the template.',
      request: {
        headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        params: z.object({
          id: Str({ description: 'Template ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Template found',
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
        '404': {
          description: 'Template not found',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
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

  async handle(c) {
    try {
      const authContext = getAuthContext(c);
      const userId = authContext?.userId;

      if (!userId) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { id } = data.params;

      // Get bucket
      const bucket = c.env['upload-defaults'];

      // Find template
      const template = await this.findTemplateById(userId, id, bucket);

      if (!template) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Verify ownership
      if (template.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      return c.json({
        success: true,
        result: {
          template,
        },
      });
    } catch (error) {
      console.error('Get upload default error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to get upload template',
        },
        500
      );
    }
  }

  /**
   * Find template by ID
   * Searches across all user's templates and channels
   */
  private async findTemplateById(
    userId: string,
    templateId: string,
    bucket: R2Bucket
  ): Promise<UploadTemplate | null> {
    const repo = new R2Repository<UploadTemplate>(bucket);

    // Try direct key first (no channel)
    const directKey = `${userId}/${templateId}`;
    const directTemplate = await repo.getObject(directKey);
    if (directTemplate) {
      return directTemplate;
    }

    // Search through channel-specific templates
    const result = await bucket.list({ prefix: `${userId}/` });

    for (const object of result.objects) {
      if (!object.key) continue;

      // Check if key ends with template ID
      if (object.key.endsWith(templateId)) {
        const template = await repo.getObject(object.key);
        if (template && template.id === templateId) {
          return template;
        }
      }
    }

    return null;
  }
}

/**
 * Update Upload Template Endpoint
 * PUT /api/upload-defaults/:id
 */
export class UpdateUploadDefaultEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'Update Upload Template',
      description:
        'Update an existing upload template. User must own the template.',
      request: {
        params: z.object({
          id: Str({ description: 'Template ID' }),
        }),
        body: {
          content: {
            'application/json': {
              schema: UpdateTemplateRequestSchema,
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Template updated successfully',
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
                errors: z
                  .array(
                    z.object({
                      field: Str(),
                      message: Str(),
                    })
                  )
                  .optional(),
              }),
            },
          },
        },
        '404': {
          description: 'Template not found',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
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

  async handle(c) {
    try {
      const authContext = getAuthContext(c);
      const userId = authContext?.userId;

      if (!userId) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { id } = data.params;
      const requestData = data.body;

      // Validate request
      const validation = validateUpdateTemplateRequest(requestData);
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

      // Get bucket
      const bucket = c.env['upload-defaults'];

      // Find template and its key
      const { template, key } = await this.findTemplateByIdWithKey(
        userId,
        id,
        bucket
      );

      if (!template || !key) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Verify ownership
      if (template.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Update template
      const updatedTemplate: UploadTemplate = {
        ...template,
        name: requestData.name !== undefined ? requestData.name : template.name,
        nameLocalized:
          requestData.nameLocalized !== undefined
            ? requestData.nameLocalized
            : template.nameLocalized,
        description:
          requestData.description !== undefined
            ? requestData.description
            : template.description,
        isDefault:
          requestData.isDefault !== undefined
            ? requestData.isDefault
            : template.isDefault,
        isActive:
          requestData.isActive !== undefined
            ? requestData.isActive
            : template.isActive,
        template: requestData.template
          ? { ...template.template, ...requestData.template }
          : template.template,
        updatedAt: new Date().toISOString(),
      };

      // Check template size
      const sizeValidation = validateTemplateSize(updatedTemplate.template);
      if (!sizeValidation.isValid) {
        return c.json(
          {
            success: false,
            error: `Template too large (${sizeValidation.size} bytes). Maximum size: ${sizeValidation.maxSize} bytes`,
          },
          400
        );
      }

      // If setting as default, unset other defaults
      if (requestData.isDefault && !template.isDefault) {
        await this.unsetOtherDefaults(
          userId,
          template.channelId,
          id,
          bucket
        );
      }

      // Save updated template
      const repo = new R2Repository<UploadTemplate>(bucket);
      await repo.putObject(key, updatedTemplate);

      return c.json({
        success: true,
        result: {
          template: updatedTemplate,
        },
      });
    } catch (error) {
      console.error('Update upload default error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to update upload template',
        },
        500
      );
    }
  }

  /**
   * Find template by ID with its R2 key
   */
  private async findTemplateByIdWithKey(
    userId: string,
    templateId: string,
    bucket: R2Bucket
  ): Promise<{ template: UploadTemplate | null; key: string | null }> {
    const repo = new R2Repository<UploadTemplate>(bucket);

    // Try direct key first (no channel)
    const directKey = `${userId}/${templateId}`;
    const directTemplate = await repo.getObject(directKey);
    if (directTemplate) {
      return { template: directTemplate, key: directKey };
    }

    // Search through channel-specific templates
    const result = await bucket.list({ prefix: `${userId}/` });

    for (const object of result.objects) {
      if (!object.key) continue;

      // Check if key ends with template ID
      if (object.key.endsWith(templateId)) {
        const template = await repo.getObject(object.key);
        if (template && template.id === templateId) {
          return { template, key: object.key };
        }
      }
    }

    return { template: null, key: null };
  }

  /**
   * Unset default flag on other templates
   */
  private async unsetOtherDefaults(
    userId: string,
    channelId: string | undefined,
    excludeTemplateId: string,
    bucket: R2Bucket
  ): Promise<void> {
    try {
      const repo = new R2Repository<UploadTemplate>(bucket);
      const prefix = channelId ? `${userId}/${channelId}/` : `${userId}/`;

      const result = await bucket.list({ prefix });

      for (const object of result.objects) {
        if (!object.key) continue;

        const template = await repo.getObject(object.key);
        if (
          template &&
          template.isDefault &&
          template.id !== excludeTemplateId
        ) {
          template.isDefault = false;
          template.updatedAt = new Date().toISOString();
          await repo.putObject(object.key, template);
        }
      }
    } catch (error) {
      console.error('Error unsetting other defaults:', error);
      // Don't fail the request if this fails
    }
  }
}

/**
 * Delete Upload Template Endpoint
 * DELETE /api/upload-defaults/:id
 */
export class DeleteUploadDefaultEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'Delete Upload Template',
      description:
        'Delete an upload template. User must own the template.',
      request: {
        params: z.object({
          id: Str({ description: 'Template ID' }),
        }),
      },
      responses: {
        '204': {
          description: 'Template deleted successfully',
        },
        '404': {
          description: 'Template not found',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
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

  async handle(c) {
    try {
      const authContext = getAuthContext(c);
      const userId = authContext?.userId;

      if (!userId) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { id } = data.params;

      // Get bucket
      const bucket = c.env['upload-defaults'];

      // Find template and its key
      const { template, key } = await this.findTemplateByIdWithKey(
        userId,
        id,
        bucket
      );

      if (!template || !key) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Verify ownership
      if (template.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Delete template
      const repo = new R2Repository<UploadTemplate>(bucket);
      await repo.deleteObject(key);

      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('Delete upload default error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to delete upload template',
        },
        500
      );
    }
  }

  /**
   * Find template by ID with its R2 key
   */
  private async findTemplateByIdWithKey(
    userId: string,
    templateId: string,
    bucket: R2Bucket
  ): Promise<{ template: UploadTemplate | null; key: string | null }> {
    const repo = new R2Repository<UploadTemplate>(bucket);

    // Try direct key first (no channel)
    const directKey = `${userId}/${templateId}`;
    const directTemplate = await repo.getObject(directKey);
    if (directTemplate) {
      return { template: directTemplate, key: directKey };
    }

    // Search through channel-specific templates
    const result = await bucket.list({ prefix: `${userId}/` });

    for (const object of result.objects) {
      if (!object.key) continue;

      // Check if key ends with template ID
      if (object.key.endsWith(templateId)) {
        const template = await repo.getObject(object.key);
        if (template && template.id === templateId) {
          return { template, key: object.key };
        }
      }
    }

    return { template: null, key: null };
  }
}

/**
 * Set Default Template Endpoint
 * PUT /api/upload-defaults/:id/default
 */
export class SetDefaultTemplateEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ['Settings'],
      summary: 'Set Default Template',
      description:
        'Set a template as the default for the user. Unsets any other default templates.',
      request: {
        params: z.object({
          id: Str({ description: 'Template ID' }),
        }),
      },
      responses: {
        '200': {
          description: 'Default template set successfully',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: true }),
              }),
            },
          },
        },
        '404': {
          description: 'Template not found',
          content: {
            'application/json': {
              schema: z.object({
                success: Bool({ example: false }),
                error: Str(),
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

  async handle(c) {
    try {
      const authContext = getAuthContext(c);
      const userId = authContext?.userId;

      if (!userId) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { id } = data.params;

      // Get bucket
      const bucket = c.env['upload-defaults'];

      // Find template and its key
      const { template, key } = await this.findTemplateByIdWithKey(
        userId,
        id,
        bucket
      );

      if (!template || !key) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Verify ownership
      if (template.userId !== userId) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // Unset other defaults
      await this.unsetOtherDefaults(userId, template.channelId, id, bucket);

      // Set this template as default
      template.isDefault = true;
      template.updatedAt = new Date().toISOString();

      const repo = new R2Repository<UploadTemplate>(bucket);
      await repo.putObject(key, template);

      return c.json({
        success: true,
      });
    } catch (error) {
      console.error('Set default template error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to set default template',
        },
        500
      );
    }
  }

  /**
   * Find template by ID with its R2 key
   */
  private async findTemplateByIdWithKey(
    userId: string,
    templateId: string,
    bucket: R2Bucket
  ): Promise<{ template: UploadTemplate | null; key: string | null }> {
    const repo = new R2Repository<UploadTemplate>(bucket);

    // Try direct key first (no channel)
    const directKey = `${userId}/${templateId}`;
    const directTemplate = await repo.getObject(directKey);
    if (directTemplate) {
      return { template: directTemplate, key: directKey };
    }

    // Search through channel-specific templates
    const result = await bucket.list({ prefix: `${userId}/` });

    for (const object of result.objects) {
      if (!object.key) continue;

      // Check if key ends with template ID
      if (object.key.endsWith(templateId)) {
        const template = await repo.getObject(object.key);
        if (template && template.id === templateId) {
          return { template, key: object.key };
        }
      }
    }

    return { template: null, key: null };
  }

  /**
   * Unset default flag on other templates
   */
  private async unsetOtherDefaults(
    userId: string,
    channelId: string | undefined,
    excludeTemplateId: string,
    bucket: R2Bucket
  ): Promise<void> {
    try {
      const repo = new R2Repository<UploadTemplate>(bucket);
      const prefix = channelId ? `${userId}/${channelId}/` : `${userId}/`;

      const result = await bucket.list({ prefix });

      for (const object of result.objects) {
        if (!object.key) continue;

        const template = await repo.getObject(object.key);
        if (
          template &&
          template.isDefault &&
          template.id !== excludeTemplateId
        ) {
          template.isDefault = false;
          template.updatedAt = new Date().toISOString();
          await repo.putObject(object.key, template);
        }
      }
    } catch (error) {
      console.error('Error unsetting other defaults:', error);
      // Don't fail the request if this fails
    }
  }
}
