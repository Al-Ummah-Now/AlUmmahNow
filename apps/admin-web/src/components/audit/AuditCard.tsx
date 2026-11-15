/**
 * An item page's Admin history (issue #745): the item's audit rows with every person and id
 * named, read in one names request on the server.
 */
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/translate';
import type { ContentAuditEntry } from '@/lib/api/content-types';
import { getNames } from '@/lib/api/audit';
import { SectionCard } from '@/components/content/parts';
import { namesRequestOf } from './audit-model';
import { AuditEntryList } from './AuditEntryList';

export async function AuditCard({ entries, t, locale }: { entries: ContentAuditEntry[]; t: Translator; locale: Locale }) {
  const names = entries.length ? await getNames(namesRequestOf(entries)) : null;
  return (
    <SectionCard title={t('content.audit')} testId="content-audit" id="content-audit-title">
      {entries.length === 0 ? <p className="text-fg-muted text-sm">{t('content.auditEmpty')}</p> : <AuditEntryList entries={entries} names={names} t={t} locale={locale} />}
    </SectionCard>
  );
}
