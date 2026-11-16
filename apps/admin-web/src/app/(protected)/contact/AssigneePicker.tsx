'use client';

/**
 * Who handles a contact message: a live autocomplete over everyone who can
 * handle contact messages (active Admins and Super Admins on the videos
 * admin's own staff list, GET /api/contact/staff), opening with all of them
 * before anything is typed. Never a raw id field.
 */
import { useCallback } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { Autocomplete, type AutocompleteSource } from '@/components/search/Autocomplete';
import { searchContactStaff } from '@/lib/api/admin';
import { logger } from '@/lib/logger-client';

export function AssigneePicker({
  onPick,
  disabled,
  testId,
  label,
}: {
  onPick: (id: string, label: string) => void;
  disabled?: boolean;
  testId: string;
  label?: string;
}) {
  const { t } = useLanguage();
  const source: AutocompleteSource = useCallback(
    async (q) => {
      try {
        const { items } = await searchContactStaff(q);
        // "me" marks the caller's own row; the others show their email under the name
        return { items: items.map((i) => ({ ...i, secondary: i.secondary === 'me' ? t('contact.youLabel') : i.secondary })), next: null };
      } catch (error) {
        logger.warn('[contact] Staff search failed', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    [t],
  );

  return (
    <Autocomplete
      kind="user"
      mode="pick"
      label={label ?? t('contact.assignTo')}
      placeholder={t('contact.assignPlaceholder')}
      source={source}
      allowIds={false}
      showIds={false}
      initialResults
      popup="inline"
      disabled={disabled}
      testId={testId}
      className="w-full min-w-0"
      messages={{
        recent: (count) => t('contact.staffCount', { count }),
        emptyList: t('contact.staffEmpty'),
        noMatches: (query) => t('contact.staffNoMatch', { query }),
      }}
      onChange={(id, item) => {
        if (id) onPick(id, item?.label ?? id);
      }}
    />
  );
}
