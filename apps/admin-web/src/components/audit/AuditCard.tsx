/**
 * An item page's Admin history (issue #745): the item's audit rows with every person and id
 * named, read in one names request on the server.
 */
import type { Locale } from '@/i18n/config';
import type { Translator } from '@/i18n/translate';
import type { ContentAuditEntry } from '@/lib/api/content-types';
import { getNames } from '@/lib/api/audit';
import { SectionCard } from '@/components/content/parts';
import { namesRequestOf, type AuditTierNames } from './audit-model';
import { listCreatorTierDefinitions } from '@/lib/api/creators';
import { AuditEntryList } from './AuditEntryList';

export async function AuditCard({ entries, t, locale }: { entries: ContentAuditEntry[]; t: Translator; locale: Locale }) {
  const names = entries.length ? await getNames(namesRequestOf(entries)) : null;
  // A user's comps name their tier (Payments lines): read the tier names only when there is one
  let tiers: AuditTierNames = {};
  if (entries.some((e) => e.action === 'billing-comp')) {
    try {
      tiers = Object.fromEntries((await listCreatorTierDefinitions()).map((tier) => [tier.id, { name: tier.name, nameAr: tier.nameAr ?? null }]));
    } catch {
      tiers = {};
    }
  }
  return (
    <SectionCard title={t('content.audit')} testId="content-audit" id="content-audit-title">
      {entries.length === 0 ? <p className="text-fg-muted text-sm">{t('content.auditEmpty')}</p> : <AuditEntryList entries={entries} names={names} t={t} locale={locale} tiers={tiers} />}
    </SectionCard>
  );
}
