/**
 * Draft model of the profile editor: the localized name and bio fields and
 * the timezone, and which of them differ from the saved profile.
 */
import type { Profile } from '@/interfaces';

export interface ProfileDraft {
  firstNameEn: string;
  firstNameAr: string;
  lastNameEn: string;
  lastNameAr: string;
  displayNameEn: string;
  displayNameAr: string;
  bioEn: string;
  bioAr: string;
  timezone: string;
}

export type ProfileDraftField = keyof ProfileDraft;

const FIELDS: ProfileDraftField[] = ['firstNameEn', 'firstNameAr', 'lastNameEn', 'lastNameAr', 'displayNameEn', 'displayNameAr', 'bioEn', 'bioAr', 'timezone'];

export function profileDraftFrom(profile: Profile, fallbackTimezone: string): ProfileDraft {
  return {
    firstNameEn: profile.firstNameLocalized?.en || profile.firstName || '',
    firstNameAr: profile.firstNameLocalized?.ar || '',
    lastNameEn: profile.lastNameLocalized?.en || profile.lastName || '',
    lastNameAr: profile.lastNameLocalized?.ar || '',
    displayNameEn: profile.displayNameLocalized?.en || profile.displayName || '',
    displayNameAr: profile.displayNameLocalized?.ar || '',
    bioEn: profile.bioLocalized?.en || profile.bio || '',
    bioAr: profile.bioLocalized?.ar || '',
    timezone: profile.timezone || fallbackTimezone,
  };
}

export function changedProfileFields(saved: ProfileDraft, draft: ProfileDraft): ProfileDraftField[] {
  return FIELDS.filter((f) => draft[f].trim() !== saved[f].trim());
}
