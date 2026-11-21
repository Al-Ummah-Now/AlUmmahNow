'use client';

import { useLanguage } from '@/i18n/I18nProvider';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';

/** A batch's name, or "Batch of <date>" when the admin gave none. */
export function BatchName({ name, createdAt }: { name: string | null; createdAt: string }) {
  const { t } = useLanguage();
  if (name) return <bdi>{name}</bdi>;
  return <>{fillNodes(t('imports.unnamed'), { date: <LocalTime value={createdAt} withTime /> })}</>;
}
