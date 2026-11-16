'use client';

import { forwardRef, useId } from 'react';
import { CheckCircle2, CircleHelp, FileX2, Hand } from 'lucide-react';
import { formatNumber, type TakeoutFile, type YtFileMatch, type YtImportItem } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { keyOfMatch, toFileMatch } from '@/lib/youtube-import/takeout';
import { freeFiles, reviewGroup, type ReviewGroup } from '@/lib/youtube-import/wizard';
import { num, useFill, StepHeading, Thumb } from './parts';

interface Props {
  items: YtImportItem[];
  files: TakeoutFile[];
  matches: ReadonlyMap<string, YtFileMatch | null>;
  onMatch: (itemId: string, match: YtFileMatch | null) => void;
  starting: boolean;
  error: string;
  onBack: () => void;
  onStart: () => void;
}

/** Titles to check first, then videos without a file, then the creator's own choices, then exact matches. */
const ORDER: ReviewGroup[] = ['byTitle', 'noFile', 'manual', 'byId'];
const ICON = { byTitle: CircleHelp, noFile: FileX2, manual: Hand, byId: CheckCircle2 } as const;
const NONE = '';

function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${formatNumber(locale === 'ar' ? 'ar' : 'en', v, { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}

export const ReviewStep = forwardRef<HTMLHeadingElement, Props>(function ReviewStep({ items, files, matches, onMatch, starting, error, onBack, onStart }, headingRef) {
  const { t, locale } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.review;
  const ids = useId();
  const groups = new Map<ReviewGroup, YtImportItem[]>(ORDER.map((g) => [g, []]));
  for (const item of items) groups.get(reviewGroup(matches.get(item.id)))!.push(item);
  const leftOut = groups.get('noFile')!.length;
  const withFile = items.length - leftOut;

  return (
    <section className="yt-panel" data-testid="yt-review">
      <StepHeading ref={headingRef} testId="yt-step-heading">{text.heading}</StepHeading>

      <div className="space-y-4">
        {ORDER.map((group) => {
          const list = groups.get(group)!;
          if (list.length === 0) return null;
          const Icon = ICON[group];
          return (
            <details key={group} open={group !== 'byId' || list.length <= 12} className="yt-group" data-group={group} data-testid={`yt-group-${group}`}>
              <summary className="yt-group-head">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 font-medium">{text[group]}</span>
                <span className="yt-count tabular-nums">{num(locale, list.length)}</span>
              </summary>
              <ul className="yt-list mt-2">
                {list.map((item) => {
                  const match = matches.get(item.id) ?? null;
                  const options = freeFiles(files, matches, item.id);
                  const selectId = `${ids}-${item.id}`;
                  return (
                    <li key={item.id} className="yt-row yt-review-row" data-testid="yt-review-row" data-item-id={item.id}>
                      <Thumb item={item} className="hidden w-24 sm:block" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium text-foreground"><bdi>{item.title}</bdi></p>
                        <label htmlFor={selectId} className="sr-only">{fill(text.chooseFile, { title: item.title })}</label>
                        <select
                          id={selectId}
                          className="yt-select mt-1.5 min-h-11 w-full"
                          value={match ? keyOfMatch(match) : NONE}
                          onChange={(e) => {
                            const file = files.find((f) => f.key === e.target.value);
                            onMatch(item.id, file ? toFileMatch(file, 'manual') : null);
                          }}
                          data-testid="yt-review-select"
                        >
                          <option value={NONE}>{text.noFileOption}</option>
                          {options.map((f) => (
                            <option key={f.key} value={f.key}>
                              {/* Each part isolated (FSI…PDI) so an Arabic file name and the Latin size/zip never reorder */}
                              {`\u2068${f.fileName}\u2069 · \u2068${formatSize(f.size, locale)}\u2069${f.zipName ? ` · \u2068${f.zipName}\u2069` : ''}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>

      {leftOut > 0 && <p className="yt-warn mt-4 rounded-md p-3 text-sm" data-testid="yt-left-out">{fill(text.leftOut, { count: leftOut })}</p>}

      <div className="yt-footer">
        <span />
        <div className="flex flex-col items-end gap-1">
          {error && <p role="alert" className="yt-error text-sm" data-testid="yt-review-error">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={onBack} data-testid="yt-review-back">{text.back}</Button>
            <Button className="min-h-11 px-6" onClick={onStart} disabled={starting || withFile === 0} data-testid="yt-start">{starting ? text.starting : text.start}</Button>
          </div>
        </div>
      </div>
    </section>
  );
});
