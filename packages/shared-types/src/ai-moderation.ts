// AI-assisted moderation (Epic 28). See docs/specs/EPIC-28-PLAN.md.

/** Where the scanned text was written. */
export type ModerationSurface = 'video_comment' | 'community_post' | 'post_comment' | 'video_metadata';

/** What a signal points at (never a copy of the content). */
export type ModerationSubjectType = 'comment' | 'post' | 'post_comment' | 'video';

export const MODERATION_SURFACE_SUBJECT: Record<ModerationSurface, ModerationSubjectType> = {
  video_comment: 'comment',
  community_post: 'post',
  post_comment: 'post_comment',
  video_metadata: 'video',
};

/**
 * Payload of MessageType.ModerationScan. The text travels only in the queue
 * message; it is not stored in D1.
 */
export interface ModerationScanPayload {
  surface: ModerationSurface;
  subjectId: string;
  /** Video id for video comments, post id for post comments. */
  parentId?: string;
  authorId?: string;
  channelId?: string;
  /** 'create' or 'edit' (edits are re-scanned). */
  event: 'create' | 'edit';
  /** Text to scan, already truncated by the sender (MODERATION_MAX_TEXT). */
  text: string;
  timestamp: string;
}

/** Longest text sent for a scan; the rest is cut (keeps queue messages and AI cost small). */
export const MODERATION_MAX_TEXT = 4000;

/** Platform extension categories (spec §3). Llama Guard categories are 'S1'..'S14'. */
export const MODERATION_EXTENSION_CATEGORIES = [
  'sectarian_hate',
  'violent_extremism',
  'charity_scam',
  'impersonation',
  'harassment',
  'spam',
  'sexual',
  'misinfo_health',
  'religious_authenticity',
] as const;
export type ModerationExtensionCategory = (typeof MODERATION_EXTENSION_CATEGORIES)[number];

/** Llama Guard 3 hazard categories. */
export const LLAMA_GUARD_CATEGORIES = {
  S1: 'violent_crimes',
  S2: 'non_violent_crimes',
  S3: 'sex_related_crimes',
  S4: 'child_sexual_exploitation',
  S5: 'defamation',
  S6: 'specialized_advice',
  S7: 'privacy',
  S8: 'intellectual_property',
  S9: 'indiscriminate_weapons',
  S10: 'hate',
  S11: 'self_harm',
  S12: 'sexual_content',
  S13: 'elections',
  S14: 'code_interpreter_abuse',
} as const;
export type LlamaGuardCategory = keyof typeof LLAMA_GUARD_CATEGORIES;

export type ModerationCategory = ModerationExtensionCategory | LlamaGuardCategory;

/** Categories the AI may ever hide (spec decision M2). Hiding is reversible. */
export const AI_HIDEABLE_CATEGORIES: readonly ModerationCategory[] = ['spam', 'charity_scam'];

export type ModerationDecision = 'none' | 'would_flag' | 'would_hide' | 'flag' | 'hide' | 'skipped';
export type ModerationSkipReason = 'disabled' | 'budget' | 'error' | 'empty';
export type ModerationReviewStatus = 'pending' | 'agreed' | 'disagreed' | 'n/a';
export type ModerationPolicyAction = 'none' | 'flag' | 'hide';
export type ModerationPolicyMode = 'shadow' | 'enforce';

export interface ModerationCategoryPolicy {
  mode: ModerationPolicyMode;
  threshold: number;
  action: ModerationPolicyAction;
  enabled: boolean;
}

/** Remote config (D1 moderation_config), as served by admin-api. */
export interface AiModerationConfig {
  enabled: boolean;
  dailyNeuronCap: number | null;
  extensionsEnabled: boolean;
  policies: Partial<Record<ModerationCategory, ModerationCategoryPolicy>>;
}

/** A moderation_signals row as returned by admin-api. */
export interface ModerationSignal {
  id: string;
  subject_type: ModerationSubjectType;
  subject_id: string;
  parent_id: string | null;
  surface: ModerationSurface;
  author_id: string | null;
  channel_id: string | null;
  language: string | null;
  categories: Record<string, number>;
  top_category: string | null;
  top_score: number | null;
  models: string | null;
  prompt_version: string | null;
  decision: ModerationDecision;
  skip_reason: ModerationSkipReason | null;
  priority: number;
  review_status: ModerationReviewStatus;
  reviewer_id: string | null;
  reviewer_decision: string | null;
  reviewed_at: string | null;
  translation: string | null;
  created_at: string;
}

export interface AiUsageDay {
  day: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  neurons: number;
  usd: number;
}
