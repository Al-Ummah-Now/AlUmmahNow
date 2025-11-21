/**
 * Template Validation
 * Validates upload template data and ensures integrity
 */

import { z } from 'zod';
import {
  VideoCategory,
  VideoVisibility,
  CommentModeration,
  VideoLicense,
  LocalizedText,
  TemplateFields,
  CreateTemplateRequest,
  UpdateTemplateRequest,
} from '@al-ummah/shared-types';
import { validateTemplateVariables } from './variables';

/**
 * Zod schema for localized text
 */
const LocalizedTextSchema = z.object({
  en: z.string(),
  ar: z.string(),
});

/**
 * Zod schema for comment settings
 */
const CommentSettingsSchema = z.object({
  enabled: z.boolean(),
  moderation: z.enum(['all', 'none', 'hold_all', 'hold_inappropriate'] as const).optional(),
});

/**
 * Zod schema for location data
 */
const LocationDataSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});

/**
 * Zod schema for schedule defaults
 */
const ScheduleDefaultsSchema = z.object({
  publishTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(), // HH:MM format
  timezone: z.string().max(50).optional(),
  premiereEnabled: z.boolean().optional(),
});

/**
 * Zod schema for template fields
 */
export const TemplateFieldsSchema = z.object({
  title: z.string().max(500).optional(),
  titleLocalized: LocalizedTextSchema.optional(),
  description: z.string().max(5000).optional(),
  descriptionLocalized: LocalizedTextSchema.optional(),
  tags: z.array(z.string().max(50)).max(30).optional(),
  category: z.nativeEnum(VideoCategory).optional(),
  visibility: z.enum(['public', 'private', 'unlisted'] as const).optional(),
  language: z.enum(['en', 'ar', 'ur', 'fr'] as const).optional(),
  commentSettings: CommentSettingsSchema.optional(),
  ageRestricted: z.boolean().optional(),
  madeForKids: z.boolean().optional(),
  location: LocationDataSchema.optional(),
  license: z.enum(['standard', 'creative_commons'] as const).optional(),
  recordingDate: z.string().optional(),
  paidPromotion: z.boolean().optional(),
  scheduleDefaults: ScheduleDefaultsSchema.optional(),
});

/**
 * Zod schema for create template request
 */
export const CreateTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  nameLocalized: LocalizedTextSchema.optional(),
  description: z.string().max(500).optional(),
  channelId: z.string().uuid().optional(),
  isDefault: z.boolean().optional(),
  template: TemplateFieldsSchema,
});

/**
 * Zod schema for update template request
 */
export const UpdateTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nameLocalized: LocalizedTextSchema.optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  template: TemplateFieldsSchema.optional(),
});

/**
 * Validation error type
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validate create template request
 */
export function validateCreateTemplateRequest(
  data: unknown
): ValidationResult {
  const errors: ValidationError[] = [];

  try {
    // Validate with Zod schema
    const parsed = CreateTemplateRequestSchema.parse(data);

    // Additional validation for template variables
    if (parsed.template.title) {
      const validation = validateTemplateVariables(parsed.template.title);
      if (!validation.isValid) {
        errors.push({
          field: 'template.title',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template.titleLocalized?.en) {
      const validation = validateTemplateVariables(parsed.template.titleLocalized.en);
      if (!validation.isValid) {
        errors.push({
          field: 'template.titleLocalized.en',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template.titleLocalized?.ar) {
      const validation = validateTemplateVariables(parsed.template.titleLocalized.ar);
      if (!validation.isValid) {
        errors.push({
          field: 'template.titleLocalized.ar',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template.description) {
      const validation = validateTemplateVariables(parsed.template.description);
      if (!validation.isValid) {
        errors.push({
          field: 'template.description',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template.descriptionLocalized?.en) {
      const validation = validateTemplateVariables(parsed.template.descriptionLocalized.en);
      if (!validation.isValid) {
        errors.push({
          field: 'template.descriptionLocalized.en',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template.descriptionLocalized?.ar) {
      const validation = validateTemplateVariables(parsed.template.descriptionLocalized.ar);
      if (!validation.isValid) {
        errors.push({
          field: 'template.descriptionLocalized.ar',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        errors.push({
          field: err.path.join('.'),
          message: err.message,
        });
      });
    } else {
      errors.push({
        field: 'unknown',
        message: 'Validation failed',
      });
    }

    return {
      isValid: false,
      errors,
    };
  }
}

/**
 * Validate update template request
 */
export function validateUpdateTemplateRequest(
  data: unknown
): ValidationResult {
  const errors: ValidationError[] = [];

  try {
    // Validate with Zod schema
    const parsed = UpdateTemplateRequestSchema.parse(data);

    // Additional validation for template variables (if provided)
    if (parsed.template?.title) {
      const validation = validateTemplateVariables(parsed.template.title);
      if (!validation.isValid) {
        errors.push({
          field: 'template.title',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template?.titleLocalized?.en) {
      const validation = validateTemplateVariables(parsed.template.titleLocalized.en);
      if (!validation.isValid) {
        errors.push({
          field: 'template.titleLocalized.en',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template?.titleLocalized?.ar) {
      const validation = validateTemplateVariables(parsed.template.titleLocalized.ar);
      if (!validation.isValid) {
        errors.push({
          field: 'template.titleLocalized.ar',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template?.description) {
      const validation = validateTemplateVariables(parsed.template.description);
      if (!validation.isValid) {
        errors.push({
          field: 'template.description',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template?.descriptionLocalized?.en) {
      const validation = validateTemplateVariables(parsed.template.descriptionLocalized.en);
      if (!validation.isValid) {
        errors.push({
          field: 'template.descriptionLocalized.en',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    if (parsed.template?.descriptionLocalized?.ar) {
      const validation = validateTemplateVariables(parsed.template.descriptionLocalized.ar);
      if (!validation.isValid) {
        errors.push({
          field: 'template.descriptionLocalized.ar',
          message: `Unknown variables: ${validation.unknownVariables.join(', ')}`,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        errors.push({
          field: err.path.join('.'),
          message: err.message,
        });
      });
    } else {
      errors.push({
        field: 'unknown',
        message: 'Validation failed',
      });
    }

    return {
      isValid: false,
      errors,
    };
  }
}

/**
 * Validate template size
 * Templates should not exceed 10KB
 */
export function validateTemplateSize(template: TemplateFields): {
  isValid: boolean;
  size: number;
  maxSize: number;
} {
  const MAX_SIZE = 10 * 1024; // 10KB
  const size = JSON.stringify(template).length;

  return {
    isValid: size <= MAX_SIZE,
    size,
    maxSize: MAX_SIZE,
  };
}
