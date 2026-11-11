import { Str, DateTime } from "chanfana";
import { z } from "zod";

// Re-export shared D1 and moderation types
export type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  Report,
  ReportableEntityType,
  ReportReason,
  ReportStatus,
  ModerationAction,
  ModerationFields,
  SoftDeleteFields,
  ContentActionResult,
  ReportStats,
} from '@al-ummah/shared-types';

// Zod schemas for validation (kept local for chanfana integration)
const SoftDeleteFieldsSchema = {
  isDeleted: z.boolean().optional(),
  deletedAt: DateTime().optional(),
  markedForDeletion: z.boolean().optional(),
  markedForDeletionAt: DateTime().optional(),
};

const ModerationFieldsSchema = {
  isHidden: z.boolean().optional(),
  hiddenAt: DateTime().optional(),
  hiddenByUserId: Str().optional(),
  hiddenReason: Str().optional(),
};

// Report Zod schema for OpenAPI documentation
export const ReportSchema = z.object({
  id: Str(),
  entity_type: z.enum(['video', 'comment', 'channel', 'livestream', 'playlist', 'post']),
  entity_id: Str(),
  reporter_id: Str(),
  reason: z.enum(['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other']),
  description: Str().optional().nullable(),
  status: z.enum(['pending', 'reviewing', 'resolved', 'dismissed']).default('pending'),
  moderator_id: Str().optional().nullable(),
  action: z.enum(['warning', 'removed', 'banned', 'deleted', 'dismissed']).optional().nullable(),
  moderator_notes: Str().optional().nullable(),
  created_at: Str(),
  updated_at: Str().optional().nullable(),
  resolved_at: Str().optional().nullable(),
});

// Video schema for R2 (simplified for moderation)
export const VideoSchema = z.object({
  id: Str(),
  title: Str(),
  userId: Str(),
  channelId: Str(),
  isPublic: z.boolean().default(true),
  ...SoftDeleteFieldsSchema,
  ...ModerationFieldsSchema,
});

// Channel schema for R2 (simplified for moderation)
export const ChannelSchema = z.object({
  id: Str(),
  userId: Str(),
  name: Str(),
  ...SoftDeleteFieldsSchema,
  ...ModerationFieldsSchema,
});

// Profile schema for R2 (simplified for admin)
export const ProfileSchema = z.object({
  id: Str(),
  email: Str().email(),
  userName: Str().optional(),
  displayName: Str().optional(),
  roles: z.array(z.string()).optional(),
});

// Utility types for API responses
export const ResponseError = z.object({
  success: z.boolean().default(false),
  error: z.string(),
  message: z.string().optional(),
});

export type ResponseErrorType = z.infer<typeof ResponseError>;
