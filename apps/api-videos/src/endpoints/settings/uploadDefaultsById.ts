/**
 * Upload Defaults By ID Endpoints
 * Get, update, and delete individual upload templates
 */

import { OpenAPIRoute, Str, Bool } from 'chanfana';
import { z } from 'zod';
import { clearDefaultTemplate, isDefaultTemplate, readDefaultPointer, setDefaultTemplate } from '../../lib/uploadDefaultPointer';
import R2Repository, { rethrowBusy } from '../../lib/r2Repo';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { getAuthContext } from '../../middleware/auth';
import { UploadTemplate, UpdateTemplateRequest } from '@al-ummah/shared-types';
import {
  UpdateTemplateRequestSchema,
  validateUpdateTemplateRequest,
  validateTemplateSize,
} from '../../lib/templates/validator';
import { logger } from '../../lib/logger';

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

      // Default from the scope's pointer document (SCALABILITY-AUDIT AV-20)
      template.isDefault = isDefaultTemplate(template, await readDefaultPointer(bucket, userId, template.channelId));

      return c.json({
        success: true,
        result: {
          template,
        },
      });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Get upload default error:', error);
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

      // Check template size of the merged result before writing
      const mergedTemplate = requestData.template
        ? { ...template.template, ...requestData.template }
        : template.template;
      const sizeValidation = validateTemplateSize(mergedTemplate);
      if (!sizeValidation.isValid) {
        return c.json(
          {
            success: false,
            error: `Template too large (${sizeValidation.size} bytes). Maximum size: ${sizeValidation.maxSize} bytes`,
          },
          400
        );
      }

      // Apply the update to the fresh template with a conditional write
      // (SCALABILITY-AUDIT AV-20); a template deleted meanwhile is not re-created
      const repo = new R2Repository<UploadTemplate>(bucket);
      const updatedTemplate = await repo.updateObject(key, (fresh) => {
        if (requestData.name !== undefined) fresh.name = requestData.name;
        if (requestData.nameLocalized !== undefined) fresh.nameLocalized = requestData.nameLocalized;
        if (requestData.description !== undefined) fresh.description = requestData.description;
        if (requestData.isDefault !== undefined) fresh.isDefault = requestData.isDefault;
        if (requestData.isActive !== undefined) fresh.isActive = requestData.isActive;
        if (requestData.template) fresh.template = { ...fresh.template, ...requestData.template };
        fresh.updatedAt = new Date().toISOString();
      });
      if (!updatedTemplate) {
        return c.json(
          {
            success: false,
            error: 'Template not found',
          },
          404
        );
      }

      // The scope's default lives in its pointer document: one conditional write
      if (requestData.isDefault === true) {
        await setDefaultTemplate(bucket, userId, updatedTemplate);
      } else if (requestData.isDefault === false) {
        await clearDefaultTemplate(bucket, userId, template);
      }
      updatedTemplate.isDefault = isDefaultTemplate(updatedTemplate, await readDefaultPointer(bucket, userId, updatedTemplate.channelId));

      return c.json({
        success: true,
        result: {
          template: updatedTemplate,
        },
      });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Update upload default error:', error);
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

      // A deleted template is no longer its scope's default (SCALABILITY-AUDIT AV-20)
      await clearDefaultTemplate(bucket, userId, template);

      return new Response(null, { status: 204 });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Delete upload default error:', error);
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

      // Set this template as its scope's default: one conditional write of the
      // scope's pointer replaces any other default (SCALABILITY-AUDIT AV-20)
      await setDefaultTemplate(bucket, userId, template);

      return c.json({
        success: true,
      });
    } catch (error) {
      rethrowBusy(error);
      logger.error('Set default template error:', error);
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

}
