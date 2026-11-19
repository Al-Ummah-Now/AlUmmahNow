'use client';

/**
 * The audit log's filters (issue #711): a GET form, so every filter is in the URL. The person
 * and the item are chosen with the shared Autocomplete (pick mode: a name, email, title or a
 * pasted id; the id travels in the hidden input). Changing the item type clears the item.
 */
import { useState } from 'react';
import Link from '@/components/AppLink';
import { ADMIN_AUDIT_AREAS, ADMIN_AUDIT_ITEM_KINDS, type AdminAuditArea, type AdminAuditItemKind, type AdminSuggestion } from '@al-ummah/shared-types';
import { Autocomplete } from '@/components/search/Autocomplete';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { actionLabel } from '@/components/audit/audit-model';
import { DateField } from '@/components/DateField';

export interface AuditFilterValues {
  actorId?: string;
  itemKind?: AdminAuditItemKind;
  itemId?: string;
  area?: AdminAuditArea;
  action?: string;
  from?: string;
  to?: string;
}

const labelClass = 'block text-sm font-medium text-fg mb-1';

export function AuditFilters({ values, actions, actorItem, targetItem }: { values: AuditFilterValues; actions: { action: string; area: AdminAuditArea }[]; actorItem: AdminSuggestion | null; targetItem: AdminSuggestion | null }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<AdminAuditItemKind | ''>(values.itemKind ?? '');
  const [area, setArea] = useState<AdminAuditArea | ''>(values.area ?? '');
  const shownActions = area ? actions.filter((a) => a.area === area || a.action === values.action) : actions;
  const options = [...shownActions].sort((a, b) => actionLabel(a.action, t).localeCompare(actionLabel(b.action, t)));

  return (
    <form method="get" action="/audit" aria-label={t('auditLog.filtersLabel')} className="bg-surface border border-border rounded-lg p-4 sm:p-6" data-testid="audit-filters">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <div className="sm:col-span-2">
          <Autocomplete
            kind="user"
            mode="pick"
            name="actorId"
            label={t('auditLog.actor')}
            placeholder={t('auditLog.actorPlaceholder')}
            hint={t('auditLog.actorHint')}
            defaultValue={values.actorId ?? ''}
            defaultItem={actorItem}
            showIds={false}
            testId="audit-actor-filter"
          />
        </div>
        <div>
          <label htmlFor="audit-item-kind" className={labelClass}>
            {t('auditLog.itemKind')}
          </label>
          <select id="audit-item-kind" name={kind ? 'itemKind' : undefined} value={kind} onChange={(e) => setKind(e.target.value as AdminAuditItemKind | '')} className={`${fieldClass} w-full`} data-testid="audit-item-kind">
            <option value="">{t('auditLog.itemAny')}</option>
            {ADMIN_AUDIT_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`auditLog.kinds.${k}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
        <div>
          {kind ? (
            <Autocomplete
              key={kind}
              kind={kind}
              mode="pick"
              name="itemId"
              label={t('auditLog.item')}
              placeholder={t('auditLog.itemPlaceholder')}
              defaultValue={kind === values.itemKind ? (values.itemId ?? '') : ''}
              defaultItem={kind === values.itemKind ? targetItem : null}
              showIds={false}
              testId="audit-item-filter"
            />
          ) : (
            <>
              <label htmlFor="audit-item-none" className={labelClass}>
                {t('auditLog.item')}
              </label>
              <input id="audit-item-none" disabled placeholder={t('auditLog.itemAny')} className={`${fieldClass} w-full opacity-60`} />
            </>
          )}
        </div>
        <div>
          <label htmlFor="audit-area" className={labelClass}>
            {t('auditLog.area')}
          </label>
          <select id="audit-area" name={area ? 'area' : undefined} value={area} onChange={(e) => setArea(e.target.value as AdminAuditArea | '')} className={`${fieldClass} w-full`} data-testid="audit-area">
            <option value="">{t('auditLog.areaAny')}</option>
            {ADMIN_AUDIT_AREAS.map((a) => (
              <option key={a} value={a}>
                {t(`auditLog.areas.${a}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-action" className={labelClass}>
            {t('auditLog.action')}
          </label>
          <select id="audit-action" name="action" defaultValue={values.action ?? ''} className={`${fieldClass} w-full`} data-testid="audit-action">
            <option value="">{t('auditLog.actionAny')}</option>
            {options.map((a) => (
              <option key={a.action} value={a.action}>
                {actionLabel(a.action, t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className={labelClass}>
            {t('auditLog.from')}
          </label>
          <DateField id="audit-from" name="from" defaultValue={values.from ?? ''} className="w-full" testId="audit-from" />
        </div>
        <div>
          <label htmlFor="audit-to" className={labelClass}>
            {t('auditLog.to')}
          </label>
          <DateField id="audit-to" name="to" defaultValue={values.to ?? ''} className="w-full" testId="audit-to" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" className={primaryButtonClass} data-testid="audit-apply">
          {t('auditLog.apply')}
        </button>
        <Link href="/audit" className={secondaryButtonClass} data-testid="audit-clear">
          {t('auditLog.clear')}
        </Link>
      </div>
    </form>
  );
}
