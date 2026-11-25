'use client';

import type { AdminJob } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { Chip } from './parts';
import { isActiveJob, jobTone } from './job-helpers';

export function JobStatusChip({ job }: { job: Pick<AdminJob, 'status'> }) {
  const { t } = useLanguage();
  const label = job.status === 'failed' ? t('jobs.failedRetry') : t(`jobs.statuses.${job.status}` as MessageKey);
  return (
    <Chip tone={jobTone(job.status)} testId="job-status">
      {isActiveJob(job) && <span aria-hidden="true" className="me-1 inline-block h-2 w-2 rounded-full bg-current animate-pulse" />}
      {label}
    </Chip>
  );
}
