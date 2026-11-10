'use client';
// Every theme, built-in and custom: duplicate one as a starting point, edit, export, import, delete.
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ID_PATTERN } from '@al-ummah/theme-packages';
import { useLanguage } from '@/i18n/I18nProvider';
import type { ThemeListItem } from '@/lib/api/admin';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { ConfirmButton } from '@/components/content/actions';
import { trashHref } from '@/lib/trash';
import { ThemeApiError, duplicate, exportUrl, importZip, removeTheme } from './api';

const action = 'text-sm font-medium underline text-fg disabled:opacity-50';

export function ThemeLibrary({ themes, canEdit, author }: { themes: ThemeListItem[]; canEdit: boolean; author: string }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [source, setSource] = useState<ThemeListItem | null>(null);
  const [form, setForm] = useState({ id: '', en: '', ar: '' });
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => setFailure(t('themeBuilder.failed', { error: e instanceof ThemeApiError ? e.message : String(e) }));
  const openDuplicate = (theme: ThemeListItem) => {
    setSource(theme);
    setForm({ id: `${theme.id}-copy`.slice(0, 40), en: `${theme.name.en} copy`, ar: `نسخة ${theme.name.ar}` });
  };
  const createCopy = () => start(async () => {
    if (!source) return;
    setFailure(null);
    try {
      const { id } = await duplicate(source, form.id, { en: form.en, ar: form.ar }, author);
      router.push(`/site-theme/themes/${id}`);
    } catch (e) { fail(e); }
  });
  const onImport = (file: File | undefined) => file && start(async () => {
    setFailure(null);
    try {
      const { id } = await importZip(new Uint8Array(await file.arrayBuffer()));
      router.push(`/site-theme/themes/${id}`);
    } catch (e) { fail(e); }
  });
  // Soft delete: the theme moves to Recently deleted (restorable for 30 days)
  const onDelete = (theme: ThemeListItem, reason: string) => {
    if (theme.active) { setFailure(t('themeBuilder.deleteActive')); return; }
    start(async () => {
      try { await removeTheme(theme.id, reason); router.refresh(); } catch (e) { fail(e); }
    });
  };

  return (
    <section className={`${cardClass} mt-8`} aria-labelledby="theme-builder-title" data-testid="theme-library">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="theme-builder-title" className="text-lg font-semibold text-fg">{t('themeBuilder.title')}</h2>
          <p className="text-sm text-fg-muted max-w-2xl">{t('themeBuilder.subtitle')}</p>
        </div>
        {canEdit && (
          <>
            <input ref={fileInput} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} data-testid="theme-import-input" />
            <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => fileInput.current?.click()} data-testid="theme-import">{pending ? t('themeBuilder.importing') : t('themeBuilder.import')}</button>
            <Link href={trashHref('theme')} className={secondaryButtonClass} data-testid="theme-recently-deleted">{t('trash.link')}</Link>
          </>
        )}
      </div>
      {failure && <ErrorAlert testId="theme-library-failed">{failure}</ErrorAlert>}
      <ul className="divide-y divide-border">
        {themes.map((theme) => (
          <li key={theme.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid={`theme-row-${theme.id}`} data-builtin={theme.builtIn} data-active={theme.active}>
            <div className="flex-1 min-w-[12rem]">
              <p className="font-medium text-fg">{theme.name[locale]} <span className="text-xs text-fg-muted" dir="ltr">{theme.id}</span></p>
              <p className="text-xs text-fg-muted">
                {theme.builtIn ? t('themeBuilder.builtIn') : t('themeBuilder.custom')}
                {' · '}{theme.latestVersion ? t('themeBuilder.published', { version: theme.latestVersion }) : t('themeBuilder.notPublished')}
                {theme.active && <> · <strong>{t('themeBuilder.active')}{theme.activeVersion ? ` (${theme.activeVersion})` : ''}</strong></>}
                {theme.basedOn && <> · {t('themeBuilder.basedOn', { base: theme.basedOn })}</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canEdit && <button type="button" className={action} disabled={pending} onClick={() => openDuplicate(theme)} data-testid={`theme-duplicate-${theme.id}`}>{t('themeBuilder.duplicate')}</button>}
              {!theme.builtIn && <Link className={action} href={`/site-theme/themes/${theme.id}`} data-testid={`theme-edit-${theme.id}`}>{t('themeBuilder.edit')}</Link>}
              {!theme.builtIn && <a className={action} href={exportUrl(theme.id, theme.latestVersion ?? 'draft')} data-testid={`theme-export-${theme.id}`}>{t('themeBuilder.export')}</a>}
              {canEdit && !theme.builtIn && (theme.active
                ? <button type="button" className={action} disabled title={t('themeBuilder.deleteActive')} data-testid={`theme-delete-${theme.id}`}>{t('themeBuilder.delete')}</button>
                : <ConfirmButton label={t('themeBuilder.delete')} title={t('confirmDialog.themeDeleteTitle')} body={t('themeBuilder.confirmDelete', { name: theme.name[locale] })} confirmLabel={t('themeBuilder.delete')} withReason typeToConfirm={theme.id} danger disabled={pending} testId={`theme-delete-${theme.id}`} dialogTestId="theme-delete-confirm" onConfirm={(reason) => onDelete(theme, reason)} />)}
            </div>
          </li>
        ))}
      </ul>
      {source && (
        <div role="dialog" aria-modal="true" aria-labelledby="dup-title" className="fixed inset-0 z-50 grid place-items-center bg-fg/40 p-4" data-testid="theme-duplicate-dialog">
          <form className={`${cardClass} w-full max-w-md space-y-3`} onSubmit={(e) => { e.preventDefault(); createCopy(); }}>
            <h3 id="dup-title" className="text-lg font-semibold text-fg">{t('themeBuilder.duplicateTitle', { name: source.name[locale] })}</h3>
            <label className="block text-sm text-fg">{t('themeBuilder.newId')}
              <input dir="ltr" required pattern={ID_PATTERN.source.slice(1, -1)} className={`${fieldClass} w-full mt-1 font-mono`} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} data-testid="theme-duplicate-id" />
              <span className="block text-xs text-fg-muted mt-1">{t('themeBuilder.newIdHelp')}</span>
            </label>
            <label className="block text-sm text-fg">{t('themeBuilder.nameEn')}
              <input dir="ltr" required maxLength={80} className={`${fieldClass} w-full mt-1`} value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} data-testid="theme-duplicate-name-en" />
            </label>
            <label className="block text-sm text-fg">{t('themeBuilder.nameAr')}
              <input dir="rtl" required maxLength={80} className={`${fieldClass} w-full mt-1`} value={form.ar} onChange={(e) => setForm({ ...form, ar: e.target.value })} data-testid="theme-duplicate-name-ar" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setSource(null)}>{t('themeBuilder.cancel')}</button>
              <button type="submit" className={primaryButtonClass} disabled={pending || !ID_PATTERN.test(form.id)} data-testid="theme-duplicate-create">{pending ? t('themeBuilder.working') : t('themeBuilder.create')}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
