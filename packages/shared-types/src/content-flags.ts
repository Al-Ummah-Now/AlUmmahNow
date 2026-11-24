/**
 * Content flags on a video (wiki E20 §5.4, §5.5), as YouTube has them: age-restricted (signed-in 18+
 * only) and made for kids (no comments, live chat, notifications or personalization). Neither is read
 * by a device's parental controls. Both do something only while the `ageRules` switch is on.
 */

export interface ContentFlagFields {
  ageRestricted?: boolean;
  /** Who set `ageRestricted`; only staff can undo what staff set */
  ageRestrictedBy?: 'creator' | 'staff';
  madeForKids?: boolean;
  /** YouTube import recorded the creator's word there; used while the video has no choice of its own */
  importedFrom?: unknown;
}

export function isAgeRestricted(video: ContentFlagFields | null | undefined): boolean {
  return video?.ageRestricted === true;
}

/** The video's own choice, else what its creator said on YouTube. */
export function isMadeForKids(video: ContentFlagFields | null | undefined): boolean {
  if (typeof video?.madeForKids === 'boolean') return video.madeForKids;
  return (video?.importedFrom as { madeForKids?: unknown } | undefined)?.madeForKids === true;
}

export interface ContentFlagInput {
  ageRestricted?: boolean;
  madeForKids?: boolean;
}

export const hasContentFlagInput = (input: ContentFlagInput): boolean => input.ageRestricted !== undefined || input.madeForKids !== undefined;

export type ContentFlagProblem = 'content_flags_conflict' | 'age_restricted_locked';

/**
 * Puts the creator's choice on `video` (changed in place), or says why not: a video can't be both, and a
 * restriction staff set is theirs to undo. Nothing is changed when there is a problem.
 */
export function applyContentFlags(video: ContentFlagFields, input: ContentFlagInput): ContentFlagProblem | null {
  const ageRestricted = input.ageRestricted ?? isAgeRestricted(video);
  const madeForKids = input.madeForKids ?? isMadeForKids(video);
  if (hasContentFlagInput(input) && ageRestricted && madeForKids) return 'content_flags_conflict';
  if (input.ageRestricted === false && isAgeRestricted(video) && video.ageRestrictedBy === 'staff') return 'age_restricted_locked';
  if (input.ageRestricted === true && !isAgeRestricted(video)) {
    video.ageRestricted = true;
    video.ageRestrictedBy = 'creator';
  } else if (input.ageRestricted === false) {
    delete video.ageRestricted;
    delete video.ageRestrictedBy;
  }
  // false is kept: it is the creator's own choice and wins over what the import recorded
  if (input.madeForKids !== undefined) video.madeForKids = input.madeForKids;
  return null;
}

/** The record fields of a new upload that chose flags; a choice that isn't allowed adds none (the request was refused). */
export function contentFlagFields(input: ContentFlagInput): Pick<ContentFlagFields, 'ageRestricted' | 'ageRestrictedBy' | 'madeForKids'> {
  const fields: ContentFlagFields = {};
  applyContentFlags(fields, input);
  return fields;
}
