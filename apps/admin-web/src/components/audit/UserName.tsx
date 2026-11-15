'use client';

/** A user id shown by name in a client component (issue #745): name links to /users/{id}, email beside it, id in the title. */
import { useLanguage } from '@/i18n/I18nProvider';
import { personView } from './audit-model';
import { PersonName } from './Named';
import { useNames } from './useNames';

export function UserName({ id, email, showEmail = true, showId = false, testId }: { id: string; email?: string | null; showEmail?: boolean; showId?: boolean; testId?: string }) {
  const { t } = useLanguage();
  const names = useNames([{ kind: 'user', id }]);
  return <PersonName person={personView(id, names, t, email ?? null)} showEmail={showEmail} showId={showId} testId={testId} />;
}
