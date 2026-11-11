/**
 * Live preview of a bulk rename: current → new title per video and
 * language, with empty, too-long and duplicate results flagged and a
 * checkbox per row to leave it out. Titles keep their own direction (an
 * Arabic title is right-to-left in an English page, and the other way).
 */
'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { renameSummary, VIDEO_TITLE_MAX, type RenameRow, type TitleLanguage } from '@al-ummah/shared-types';

const PAGE = 50;

interface RenamePreviewProps {
  rows: RenameRow[];
  onToggle: (id: string, include: boolean) => void;
  testId?: string;
}

const dirOf = (lang: TitleLanguage) => (lang === 'ar' ? 'rtl' : 'ltr');

export function RenamePreview({ rows, onToggle, testId = 'rename-preview' }: RenamePreviewProps) {
  const { t, lang, isRTL } = useLanguage();
  const r = t.bulkEdit.rename;
  const [showAll, setShowAll] = useState(false);
  const summary = useMemo(() => renameSummary(rows), [rows]);
  const shown = showAll ? rows : rows.slice(0, PAGE);
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');
  const Arrow = isRTL ? ArrowLeft : ArrowRight;

  const problemText = (p: RenameRow['problems'][number]) =>
    p === 'empty' ? r.problemEmpty : p === 'too_long' ? r.problemTooLong.replace('{max}', fmt(VIDEO_TITLE_MAX)) : r.problemDuplicate;

  return (
    <section aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h4 id={`${testId}-title`} className="text-sm font-semibold text-[var(--fanous-color-text-primary)]">{r.preview}</h4>
      <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]" role="status" aria-live="polite" data-testid={`${testId}-summary`}
        data-applies={summary.applies} data-blocked={summary.blocked} data-duplicates={summary.duplicates}>
        {r.summary
          .replace('{applies}', fmt(summary.applies))
          .replace('{blocked}', fmt(summary.blocked))
          .replace('{duplicates}', fmt(summary.duplicates))
          .replace('{unchanged}', fmt(summary.unchanged))}
      </p>
      <div className="mt-2 max-h-80 overflow-auto rounded-md border border-[var(--fanous-color-divider)]">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{r.previewCaption}</caption>
          <thead className="sticky top-0 bg-[var(--fanous-color-surface-raised)]">
            <tr className="text-start text-xs text-[var(--fanous-color-text-secondary)]">
              <th scope="col" className="w-12 p-2 text-start font-medium">{r.colInclude}</th>
              <th scope="col" className="w-16 p-2 text-start font-medium">{r.colField}</th>
              <th scope="col" className="p-2 text-start font-medium">{r.colBefore}</th>
              <th scope="col" className="w-6 p-2"><span className="sr-only">→</span></th>
              <th scope="col" className="p-2 text-start font-medium">{r.colAfter}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const blocked = row.problems.some((p) => p !== 'duplicate');
              return (
                <tr
                  key={`${row.id}:${row.language}`}
                  className="border-t border-[var(--fanous-color-divider)] align-top"
                  data-testid={`${testId}-row`}
                  data-id={row.id}
                  data-language={row.language}
                  data-excluded={row.excluded ? 'true' : 'false'}
                  data-problems={row.problems.join(' ')}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={!row.excluded}
                      onChange={(e) => onToggle(row.id, e.target.checked)}
                      aria-label={r.include.replace('{title}', row.before || r.emptyValue)}
                      className="h-5 w-5 accent-[var(--fanous-color-primary)]"
                      data-testid={`${testId}-include`}
                    />
                  </td>
                  <td className="p-2 text-xs text-[var(--fanous-color-text-secondary)]">{row.language === 'ar' ? r.langAr : r.langEn}</td>
                  <td className="p-2 text-[var(--fanous-color-text-secondary)]" dir={dirOf(row.language)} lang={row.language}>
                    <bdi>{row.before || r.emptyValue}</bdi>
                  </td>
                  <td className="p-2 text-[var(--fanous-color-text-muted)]"><Arrow className="h-4 w-4" aria-hidden="true" /></td>
                  <td className="p-2">
                    <span
                      dir={dirOf(row.language)}
                      lang={row.language}
                      className={`block break-words ${row.excluded ? 'text-[var(--fanous-color-text-muted)] line-through' : 'text-[var(--fanous-color-text-primary)]'}`}
                      data-testid={`${testId}-after`}
                    >
                      <bdi>{row.excluded ? row.before || r.emptyValue : row.after || r.emptyValue}</bdi>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.excluded && <Badge>{r.excluded}</Badge>}
                      {!row.excluded && !row.changed && row.problems.length === 0 && <Badge>{r.unchanged}</Badge>}
                      {row.problems.map((p) => (
                        <Badge key={p} tone={blocked && p !== 'duplicate' ? 'error' : 'warn'}>
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {problemText(p)}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > PAGE && (
        <button type="button" className="b b-ghost b-sm mt-2" onClick={() => setShowAll(true)} data-testid={`${testId}-show-all`}>
          {r.showMore.replace('{count}', fmt(rows.length))}
        </button>
      )}
    </section>
  );
}

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'error' }) {
  const color = tone === 'error'
    ? 'border-[var(--fanous-color-error-text)] text-[var(--fanous-color-error-text)]'
    : tone === 'warn'
      ? 'border-[var(--fanous-color-outline)] text-[var(--fanous-color-text-primary)]'
      : 'border-[var(--fanous-color-divider)] text-[var(--fanous-color-text-secondary)]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}

export default RenamePreview;
