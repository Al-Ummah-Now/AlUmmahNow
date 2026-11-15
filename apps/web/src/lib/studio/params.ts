/**
 * Search-param parsers for Studio pages. Kept out of the 'use client'
 * components so the server pages can call them (a server component can't call
 * a function exported from a client module).
 */

import { PostStatus } from '@al-ummah/shared-types';
import type { StudioCommentTab } from '@/lib/api/studio-comments';

/** Content → Posts: posts are published or scheduled (the API has no post drafts). */
export const POST_STATUSES = [PostStatus.PUBLISHED, PostStatus.SCHEDULED] as const;
export type PostListStatus = (typeof POST_STATUSES)[number];

export function parsePostStatus(value: string | string[] | undefined): PostListStatus {
  return value === PostStatus.SCHEDULED ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
}

/** Customisation → Layout views */
export type LayoutView = 'sections' | 'tabs';

export function parseLayoutView(value: string | string[] | undefined): LayoutView {
  return value === 'tabs' ? 'tabs' : 'sections';
}

/** Comments lists (spec §4.7) */
export const COMMENT_TABS: readonly StudioCommentTab[] = ['inbox', 'held', 'removed'];
/** The bulk route takes up to 50 comments */
export const MAX_COMMENT_SELECTION = 50;

export function parseCommentTab(value: string | string[] | undefined): StudioCommentTab {
  return value === 'held' || value === 'removed' ? value : 'inbox';
}

/** `video:<id>` or `post:<id>`; anything else is ignored */
export function parseCommentTarget(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && /^(video|post):[\w-]{1,128}$/.test(value) ? value : undefined;
}
