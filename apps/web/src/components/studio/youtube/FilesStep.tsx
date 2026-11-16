'use client';

import { forwardRef, useId, useRef } from 'react';
import { AlertTriangle, ExternalLink, FileArchive, FileVideo, FolderOpen, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import type { TakeoutSet } from '@/lib/youtube-import/takeout';
import { num, useFill, StepHeading } from './parts';

interface Props {
  takeout: TakeoutSet;
  reading: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (name: string) => void;
  /** Chosen videos with a file / chosen videos */
  matched: number;
  selected: number;
  /** Resume after a reload: pick the same files again */
  resume?: boolean;
  onBack?: () => void;
  onNext?: () => void;
}

const TAKEOUT_URL = 'https://takeout.google.com/';

export const FilesStep = forwardRef<HTMLHeadingElement, Props>(function FilesStep({ takeout, reading, onAdd, onRemove, matched, selected, resume, onBack, onNext }, headingRef) {
  const { t, lang } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.files;
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const videoCount = takeout.files.length;

  const picker = (
    <div
      className="yt-drop"
      data-testid="yt-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length && !reading) onAdd(files);
      }}
    >
      <FolderOpen className="h-8 w-8 text-primary" aria-hidden="true" />
      <div className="text-center">
        <Button onClick={() => input.current?.click()} disabled={!!reading} className="min-h-11 px-5" data-testid="yt-choose-files">{text.choose}</Button>
        <p id={`${ids}-help`} className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">{text.chooseHelp}</p>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept=".zip,application/zip,video/*,.csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onAdd(files);
        }}
        data-testid="yt-file-input"
      />
    </div>
  );

  return (
    <section className={resume ? 'yt-card p-4 sm:p-5' : 'yt-panel'} data-testid={resume ? 'yt-files-resume' : 'yt-files'}>
      <StepHeading ref={headingRef} body={resume ? text.resumeBody : text.body} testId="yt-step-heading">{resume ? text.resumeTitle : text.heading}</StepHeading>

      <div className={resume ? '' : 'grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]'}>
        {!resume && (
          <div className="yt-card self-start p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{text.howTitle}</h3>
            <ol className="yt-how space-y-3">
              {text.how.map((line, i) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-foreground">
                  <span className="yt-how-n" aria-hidden="true">{num(lang, i + 1)}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
            <Button asChild variant="outline" className="mt-4 min-h-11 w-full gap-2">
              <a href={TAKEOUT_URL} target="_blank" rel="noopener noreferrer" data-testid="yt-open-takeout">
                {text.openTakeout}
                <ExternalLink className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </a>
            </Button>
          </div>
        )}

        <div className="space-y-4">
          {picker}

          <p role="status" aria-live="polite" className="text-sm text-muted-foreground" data-testid="yt-files-status">
            {reading ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{fill(text.reading, { name: reading })}</span>
            ) : takeout.picked.length > 0 ? (
              fill(text.found, { videos: videoCount, files: takeout.picked.length })
            ) : null}
          </p>

          {takeout.problems.map((p) => (
            <p key={p.fileName} role="alert" className="yt-warn flex items-start gap-2 rounded-md p-3 text-sm" data-testid="yt-file-problem">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span dir="auto">{fill(p.code === 'encrypted' ? text.encrypted : text.unreadable, { name: p.fileName })}</span>
            </p>
          ))}

          {takeout.picked.length > 0 && (
            <>
              <ul className="yt-list" data-testid="yt-picked-list">
                {takeout.picked.map((name) => {
                  const zip = /\.zip$/i.test(name);
                  const inside = takeout.files.filter((f) => f.zipName === name).length;
                  return (
                    <li key={name} className="yt-row" data-testid="yt-picked-file">
                      {zip ? <FileArchive className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> : <FileVideo className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground" dir="auto">{name}</span>
                        {zip && <span className="text-xs text-muted-foreground">{fill(text.inZip, { count: inside })}</span>}
                      </span>
                      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => onRemove(name)} aria-label={fill(text.remove, { name })} data-testid="yt-remove-file">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p className={`rounded-md p-3 text-sm ${takeout.csv.length > 0 ? 'yt-ok' : 'yt-warn'}`} data-testid="yt-csv-state">
                {takeout.csv.length > 0 ? text.csvFound : text.csvMissing}
              </p>
            </>
          )}
        </div>
      </div>

      {!resume && (
        <div className="yt-footer">
          <p className="text-sm text-foreground" aria-live="polite" data-testid="yt-matched-count">{takeout.picked.length > 0 ? fill(text.matched, { matched, selected }) : ''}</p>
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={onBack} data-testid="yt-files-back">{text.back}</Button>
            <Button className="min-h-11 px-6" onClick={onNext} disabled={!!reading || takeout.files.length === 0} data-testid="yt-files-next">{text.next}</Button>
          </div>
        </div>
      )}
    </section>
  );
});
