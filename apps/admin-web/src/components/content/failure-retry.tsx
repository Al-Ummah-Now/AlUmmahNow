'use client';

/** Before a Retry of videos whose own file is the cause: the in-app dialog says it cannot help. */
import { useCallback } from 'react';
import type { VideoFailure } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { causedByFile } from '@/lib/video-failure';
import { useConfirm } from './actions';

export function useRetryConfirm(failures: Readonly<Record<string, Pick<VideoFailure, 'cause'>>>) {
  const { t } = useLanguage();
  const { confirm, dialog } = useConfirm();
  const mayRetry = useCallback(
    async (ids: readonly string[]) => {
      const byFile = ids.filter((id) => causedByFile(failures[id])).length;
      if (!byFile) return true;
      return confirm({
        title: t('videoFailure.retryTitle'),
        body: ids.length === 1 ? t('videoFailure.retryBody') : t('videoFailure.retryBodySome', { count: byFile }),
        confirmLabel: t('videoFailure.retryAnyway'),
        testId: 'failure-retry-confirm',
      });
    },
    [confirm, failures, t],
  );
  return { mayRetry, dialog };
}
