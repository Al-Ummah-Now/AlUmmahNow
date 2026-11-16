/** URL slugs of the editable emails (`creator_invite` ↔ `creator-invite`). */
import { isEmailTemplateKey, type EmailTemplateKey } from '@al-ummah/shared-types';

export const slugOfTemplate = (key: EmailTemplateKey): string => key.replace(/_/g, '-');

export function templateOfSlug(slug: string): EmailTemplateKey | null {
  const key = slug.replace(/-/g, '_');
  return isEmailTemplateKey(key) ? key : null;
}
