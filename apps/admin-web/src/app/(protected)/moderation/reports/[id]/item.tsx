import type { Report, ReportedItemSummary } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { CopyId } from '@/components/audit/CopyId';
import { cardClass, linkClass, primaryButtonClass } from '@/components/ui';
import { translateDynamic, type Translator } from '@/i18n/translate';

/** What was reported, so a moderator can tell without looking it up: its text or title, whose it is and where. */
export function ReportedItem({ item, t }: { item: ReportedItemSummary; t: Translator }) {
  const state = item.takenDown ? t('report.itemTakenDown') : !item.found ? t(item.title || item.owner || item.channel ? 'report.itemGoneKept' : 'report.itemGone') : item.isDeleted ? t('report.itemDeleted') : item.isHidden ? t('report.itemHidden') : null;
  return (
    <section className="mt-6 pt-6 border-t border-border" aria-labelledby="report-item-title" data-testid="report-item" data-found={item.found} data-taken-down={item.takenDown || undefined}>
      <h2 id="report-item-title" className="text-fg-muted text-sm mb-2">{t('report.item')}</h2>
      {item.title && <p className="text-fg whitespace-pre-wrap break-words" dir="auto" data-testid="report-item-text">{item.title}</p>}
      {state && <p className="text-fg-muted text-sm mt-1" data-testid="report-item-state">{state}</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
        {item.owner && (
          <div>
            <dt className="text-fg-muted text-sm">{t('report.owner')}</dt>
            <dd>
              <Link href={`/users/${encodeURIComponent(item.owner.id)}`} className={linkClass} data-testid="report-item-owner">
                <bdi>{item.owner.name ?? t('auditLog.unknownUser')}</bdi>
              </Link>
              {!item.owner.name && <span className="ms-1.5"><CopyId id={item.owner.id} /></span>}
            </dd>
          </div>
        )}
        {item.channel && (
          <div>
            <dt className="text-fg-muted text-sm">{t('report.channel')}</dt>
            <dd>
              <Link href={`/channels/${encodeURIComponent(item.channel.id)}`} className={linkClass} data-testid="report-item-channel">
                <bdi>{item.channel.name ?? item.channel.id}</bdi>
              </Link>
            </dd>
          </div>
        )}
        {item.parentId && (
          <div>
            <dt className="text-fg-muted text-sm">{item.parentType ? t('report.on', { type: translateDynamic(t, 'entityType', item.parentType) }) : t('report.parent')}</dt>
            <dd className="text-fg font-mono text-sm break-all"><bdi dir="ltr">{item.parentId}</bdi></dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/**
 * A child safety report: what to do about it. Opening a case takes the item down, so the button only fills in the
 * intake (a person still sends it), and only with a page that opens a case for exactly this item (admin-api
 * lib/moderation/intakeUrl.ts).
 */
export function ChildSafetyCard({ report, intake, superAdmin, open, t }: { report: Report; intake: { url: string | null; evidence: boolean } | null; superAdmin: boolean; open: boolean; t: Translator }) {
  if (!open && !intake?.evidence) return null;
  return (
    <section className={`${cardClass} mb-6 border-danger-border`} aria-labelledby="child-safety-title" data-testid="child-safety-card">
      <h2 id="child-safety-title" className="text-lg font-semibold text-fg mb-2">{t('report.childSafetyTitle')}</h2>
      {open && (
        <>
          <p className="text-sm text-fg-muted mb-3">{t('report.childSafetyBody')}</p>
          {!superAdmin ? (
            <p className="text-sm text-fg" data-testid="child-safety-tell">{t('report.childSafetyTell')}</p>
          ) : intake?.url ? (
            <Link href={`/moderation/csam?prefill=${encodeURIComponent(intake.url)}`} className={`${primaryButtonClass} inline-block`} data-testid="child-safety-open-case">
              {t('report.childSafetyOpenCase')}
            </Link>
          ) : (
            <p className="text-sm text-fg" data-testid="child-safety-no-page">{t('report.childSafetyNoPage')}</p>
          )}
        </>
      )}
      {intake?.evidence && (
        <p className="text-sm mt-3">
          <a href={`/api/csam/report-evidence/${encodeURIComponent(report.entity_type)}/${encodeURIComponent(report.entity_id)}?report=${encodeURIComponent(report.id)}`} className={linkClass} data-testid="child-safety-record">
            {t('report.childSafetyRecord')}
          </a>
        </p>
      )}
    </section>
  );
}
