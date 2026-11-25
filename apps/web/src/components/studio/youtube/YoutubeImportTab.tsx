'use client';

/**
 * Studio → Content → Move from YouTube (wiki AUN-YT-IMPORT). Five steps:
 * connect the YouTube channel (Google consent, read only), choose videos and
 * playlists, add the Google Takeout files, check which file goes with which
 * video, then import: the files upload from this browser, two at a time,
 * through the normal resumable upload; the server brings titles, thumbnails,
 * captions, dates and playlists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { YtFileMatch, YtImport, YtImportItem, YtImportPlaylist, YtVisibilityMode } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { channelPath } from '@/lib/channel-url';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';
import { shareLink } from '@/lib/share/short-link';
import { uploadErrorMessage } from '@/lib/upload/report-upload-error';
import {
  cancelImport,
  downloadLinkBackCsv,
  finishOAuth,
  getImport,
  getImportStatus,
  retryItem,
  saveMatches,
  saveSelection,
  startImport,
  startOAuth,
  isFeatureOff,
  leaveToDashboard,
  YtImportApiError,
  type YtImportStatusView,
} from '@/lib/youtube-import/api';
import { addTakeoutFiles, emptyTakeoutSet, keyOfMatch, removeTakeoutFile, type TakeoutSet } from '@/lib/youtube-import/takeout';
import { ImportUploader } from '@/lib/youtube-import/uploader';
import { markCreatorTermsRequired, needsCreatorTerms, useCreatorAccess } from '@/hooks/useCreatorAccess';
import { CreatorTermsDialog } from '@/components/legal/CreatorTermsGate';
import {
  computeMatches,
  connectErrorKey,
  finishErrorKey,
  importErrorKey,
  importItems,
  initialStep,
  isSettled,
  matchesPayload,
  needsUpload,
  pickable,
  progressCounts,
  selectionPayload,
  type LiveState,
  type WizardStep,
} from '@/lib/youtube-import/wizard';
import { ConnectStep, YoutubeMark } from './ConnectStep';
import { FilesStep } from './FilesStep';
import { ImportStep } from './ImportStep';
import { PickStep } from './PickStep';
import { ReviewStep } from './ReviewStep';
import { Stepper } from './parts';
import '@/theme/youtube-import.css';

interface Props {
  locale: string;
  channelId: string;
  channelHandle: string | null;
}

const POLL_MS = 5000;
const LISTING_POLL_MS = 3000;

function errorCodeOf(error: unknown): string | null {
  return error instanceof YtImportApiError ? error.code : null;
}

export function YoutubeImportTab({ locale, channelId, channelHandle }: Props) {
  const { t } = useLanguage();
  const creator = useCreatorAccess();
  const text = t.studio.youtube;
  const lang = locale === 'ar' ? 'ar' : 'en';

  const [load, setLoad] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<YtImportStatusView | null>(null);
  const [current, setCurrent] = useState<YtImport | null>(null);
  const [items, setItems] = useState<YtImportItem[]>([]);
  const [playlists, setPlaylists] = useState<YtImportPlaylist[]>([]);
  const [step, setStep] = useState<WizardStep>('connect');

  const [captions, setCaptions] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [visibilityMode, setVisibilityMode] = useState<YtVisibilityMode>('keep');
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState('');

  const [takeout, setTakeout] = useState<TakeoutSet>(emptyTakeoutSet);
  const [reading, setReading] = useState<string | null>(null);
  const [matches, setMatches] = useState<Map<string, YtFileMatch | null>>(new Map());
  const keptRef = useRef<Map<string, YtFileMatch | null>>(new Map());

  const [live, setLive] = useState<Map<string, LiveState>>(new Map());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsPaused, setTermsPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const uploaderRef = useRef<ImportUploader | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  /** A failure the user sees: reported (admin Errors page), shown with its reference. */
  const shown = useCallback(
    (message: string, error: unknown, where: string) => {
      // A switched-off feature is not a failure: the page is already leaving for the dashboard
      if (isFeatureOff(error)) return '';
      const status = error instanceof YtImportApiError ? error.status : undefined;
      const ref = reportError(error, { shown: true, ...(status ? { status } : {}), extra: { feature: 'youtube-import', where, channelId } });
      return uploadErrorMessage(message, ref, lang);
    },
    [channelId, lang],
  );

  const applyDetail = useCallback((imp: YtImport, nextItems: YtImportItem[], nextPlaylists: YtImportPlaylist[]) => {
    setCurrent(imp);
    setItems(nextItems);
    setPlaylists(nextPlaylists);
  }, []);

  // First load: the status, then the import (?import= after Google's redirect, else the latest one)
  useEffect(() => {
    const controller = new AbortController();
    // Google's redirect lands here with ?connect=<state> or ?error=<code>; a notification links ?import=<id>
    const params = new URLSearchParams(window.location.search);
    const queryImport = params.get('import');
    const queryError = params.get('error');
    const queryConnect = params.get('connect');
    // Off the URL at once: a reload or a shared link must never send the one-time state again
    if (queryImport || queryError || queryConnect) {
      window.history.replaceState(window.history.state, '', `/${locale}/studio/${encodeURIComponent(channelId)}/content/youtube`);
    }
    void (async () => {
      try {
        const status = await getImportStatus(channelId, controller.signal);
        // The server only answers while the feature is on; never show a half-ready wizard
        if (!status.ready) {
          leaveToDashboard();
          return;
        }
        setView(status);
        let errorKey: string | null = connectErrorKey(queryError);
        if (errorKey) setConnectError(text.errors[errorKey as keyof typeof text.errors]);
        let connected: string | null = null;
        if (queryConnect && !errorKey && status.ready) {
          try {
            connected = (await finishOAuth(queryConnect)).id;
          } catch (error) {
            if (controller.signal.aborted || isFeatureOff(error)) return;
            const refused = error instanceof YtImportApiError ? finishErrorKey(error.status, error.code) : null;
            errorKey = refused ?? 'failed';
            if (refused) {
              logger.debug('[YtImport] Connection refused at finish', { channelId, refused });
              setConnectError(text.errors[refused]);
            } else {
              logger.error('[YtImport] Could not finish the connection', { channelId, error });
              setConnectError(shown(text.errors.failed, error, 'oauth-finish'));
            }
          }
        }
        const id = connected || queryImport || status.import?.id || null;
        let imp: YtImport | null = status.import;
        if (id && status.ready) {
          const detail = await getImport(id, controller.signal);
          imp = detail.import;
          applyDetail(detail.import, detail.items, detail.playlists);
          setSelected(new Set(detail.items.filter((i) => i.selected && pickable(i)).map((i) => i.id)));
          setSelectedPlaylists(new Set(detail.playlists.filter((p) => p.selected).map((p) => p.ytPlaylistId)));
          setVisibilityMode(detail.import.visibilityMode);
        }
        // The server gave up on the latest import (reading the channel failed, access removed): say why
        if (!errorKey && imp?.status === 'failed') setConnectError(text.errors[importErrorKey(imp.error)]);
        setStep(errorKey ? 'connect' : initialStep(imp && imp.status !== 'cancelled' ? imp : null));
        setLoad('ready');
      } catch (error) {
        // Switched off meanwhile: api.ts is already taking the user to the dashboard
        if (controller.signal.aborted || isFeatureOff(error)) return;
        const code = errorCodeOf(error);
        if (code === 'uploads_by_invitation' || code === 'youtube_import_not_found' || code === 'terms_required') {
          if (code === 'terms_required') {
            markCreatorTermsRequired();
            setTermsOpen(true);
          }
          setLoadError(text.errors[code]);
        } else {
          logger.error('[YtImport] Could not load the import', { channelId, error });
          setLoadError(shown(text.errors.load, error, 'load'));
        }
        setLoad('failed');
      }
    })();
    return () => controller.abort();
    // The query is read once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Focus moves to the new step's heading (not on the first render)
  useEffect(() => {
    if (load !== 'ready') return;
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, load]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!current) return;
    const detail = await getImport(current.id, signal);
    applyDetail(detail.import, detail.items, detail.playlists);
    return detail;
  }, [applyDetail, current]);

  // The uploader lives across renders; it reads the import through this ref, never a stale closure
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // While the channel is being read: follow it, then open Choose videos
  useEffect(() => {
    if (!current || current.status !== 'listing') return;
    const timer = setInterval(() => {
      refresh()
        .then((detail) => {
          if (detail && detail.import.status === 'ready') {
            setSelected(new Set());
            setStep('pick');
          }
          if (detail && detail.import.status === 'failed') setConnectError(text.errors[importErrorKey(detail.import.error)]);
        })
        .catch((error: unknown) => logger.warn('[YtImport] Listing poll failed', { error }));
    }, LISTING_POLL_MS);
    return () => clearInterval(timer);
  }, [current, refresh, text]);

  // While importing: poll every 5 s (processing, thumbnails, captions and playlists finish on the server)
  useEffect(() => {
    if (step !== 'import' || !current || current.status !== 'importing') return;
    const timer = setInterval(() => {
      refresh().catch((error: unknown) => logger.warn('[YtImport] Progress poll failed', { error }));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [step, current, refresh]);

  const setItemLive = useCallback((itemId: string, state: LiveState | null) => {
    setLive((prev) => {
      const next = new Map(prev);
      if (state) next.set(itemId, { ...prev.get(itemId), ...state, ...(state.phase !== 'uploading' ? { percent: undefined, reconnecting: undefined } : {}) });
      else next.delete(itemId);
      return next;
    });
  }, []);

  const handleTermsRequired = useCallback(() => {
    markCreatorTermsRequired();
    setTermsPaused(true);
    setTermsOpen(true);
  }, []);

  const uploader = useCallback(() => {
    if (!current) return null;
    if (!uploaderRef.current) {
      uploaderRef.current = new ImportUploader({
        importId: current.id,
        channelId,
        takeout,
        onState: setItemLive,
        onTermsRequired: handleTermsRequired,
        onServerChanged: () => void refreshRef.current().catch((error: unknown) => logger.warn('[YtImport] Refresh after a refusal failed', { error })),
      });
    }
    return uploaderRef.current;
  }, [channelId, current, handleTermsRequired, setItemLive, takeout]);

  useEffect(() => {
    uploaderRef.current?.setTakeout(takeout);
  }, [takeout]);

  // Resume automatically if the creator accepted Terms in another tab or the switch was turned off
  useEffect(() => {
    if (!termsPaused) return;
    if (creator.status === 'ready' && creator.access.termsAccepted !== false) {
      setTermsPaused(false);
      uploaderRef.current?.resume();
    }
  }, [creator, termsPaused]);

  // Leaving the page pauses the uploads (stored offsets stay; coming back resumes them)
  useEffect(() => () => void uploaderRef.current?.stop(), []);

  // On the Import step, every item whose file is here and whose bytes still have to go up is queued
  useEffect(() => {
    if (step !== 'import' || !current || current.status !== 'importing') return;
    const pending = items.filter((i) => needsUpload(i) && takeout.sources.has(keyOfMatch(i.match!)));
    const u = uploader();
    if (u && pending.length) u.enqueue(pending.filter((i) => !u.has(i.id) && (!live.has(i.id) || live.get(i.id)!.phase === 'needsFile')));
  }, [step, current, items, takeout, uploader, live]);

  // ------------------------------------------------------------------ actions

  const connect = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const url = await startOAuth(channelId, captions && !!view?.captionsAvailable, lang);
      window.location.assign(url);
    } catch (error) {
      if (isFeatureOff(error)) return;
      const code = errorCodeOf(error);
      if (code === 'terms_required') {
        markCreatorTermsRequired();
        setTermsOpen(true);
      }
      setConnectError(code === 'uploads_by_invitation' || code === 'terms_required' ? text.errors[code] : shown(text.errors.failed, error, 'oauth-start'));
      setConnecting(false);
    }
  };

  const toFiles = async () => {
    if (!current) return;
    setSaving(true);
    setStepError('');
    try {
      const imp = await saveSelection(current.id, selectionPayload(items, selected, selectedPlaylists, playlists, visibilityMode));
      setCurrent(imp);
      setItems((prev) => prev.map((i) => ({ ...i, selected: selected.has(i.id) && pickable(i) })));
      setStep('files');
    } catch (error) {
      logger.error('[YtImport] Could not save the selection', { importId: current.id, error });
      setStepError(shown(text.errors.save, error, 'selection'));
    } finally {
      setSaving(false);
    }
  };

  const selectedItems = useMemo(() => items.filter((i) => pickable(i) && selected.has(i.id)), [items, selected]);

  const addFiles = async (files: File[]) => {
    const next = await addTakeoutFiles(takeout, files, setReading);
    setReading(null);
    setTakeout(next);
    setMatches(computeMatches(selectedItems, next.files, next.csv, keptRef.current));
  };

  const removeFile = (name: string) => {
    const next = removeTakeoutFile(takeout, name);
    setTakeout(next);
    setMatches(computeMatches(selectedItems, next.files, next.csv, keptRef.current));
  };

  const matchedCount = selectedItems.filter((i) => matches.get(i.id)).length;

  const setMatch = (itemId: string, match: YtFileMatch | null) => {
    keptRef.current.set(itemId, match);
    setMatches((prev) => new Map(prev).set(itemId, match));
  };

  const start = async () => {
    if (!current) return;
    if (needsCreatorTerms(creator)) {
      setTermsOpen(true);
      return;
    }
    setSaving(true);
    setStepError('');
    try {
      await saveMatches(current.id, matchesPayload(selectedItems, matches));
      const imp = await startImport(current.id);
      setCurrent(imp);
      await refresh();
      setStep('import');
    } catch (error) {
      logger.error('[YtImport] Could not start the import', { importId: current.id, error });
      setStepError(shown(text.errors.save, error, 'start'));
    } finally {
      setSaving(false);
    }
  };

  // After a reload: the same files again; only the items whose files are picked continue
  const addResumeFiles = async (files: File[]) => {
    const next = await addTakeoutFiles(takeout, files, setReading);
    setReading(null);
    setTakeout(next);
  };

  const retry = async (item: YtImportItem) => {
    if (!current) return;
    if (uploaderRef.current?.isPausedForTerms() || live.get(item.id)?.errorCode === 'terms_required') {
      setTermsOpen(true);
      return;
    }
    setRetrying((prev) => new Set(prev).add(item.id));
    try {
      const updated = await retryItem(current.id, item.id);
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      setItemLive(item.id, null);
      if (updated.match && takeout.sources.has(keyOfMatch(updated.match))) uploader()?.enqueue([updated]);
    } catch (error) {
      logger.error('[YtImport] Retry failed', { importId: current.id, itemId: item.id, error });
      setItemLive(item.id, { phase: 'failed', errorCode: 'generic', reference: reportError(error, { shown: true, extra: { feature: 'youtube-import', where: 'retry' } }) });
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const onCancel = async (confirmed: boolean) => {
    setConfirmCancel(false);
    if (!confirmed || !current) return;
    try {
      await uploaderRef.current?.stop();
      uploaderRef.current = null;
      await cancelImport(current.id);
      setCurrent(null);
      setItems([]);
      setPlaylists([]);
      setLive(new Map());
      setTakeout(emptyTakeoutSet());
      setMatches(new Map());
      keptRef.current = new Map();
      setNotice(text.progress.cancelled);
      setStep('connect');
    } catch (error) {
      logger.error('[YtImport] Cancel failed', { importId: current.id, error });
      setNotice(shown(text.errors.save, error, 'cancel'));
    }
  };

  const downloadCsv = async () => {
    if (!current) return;
    try {
      const blob = await downloadLinkBackCsv(current.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'link-back.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(shown(text.errors.load, error, 'link-back-csv'));
    }
  };

  const newImport = () => {
    void uploaderRef.current?.stop();
    uploaderRef.current = null;
    setCurrent(null);
    setItems([]);
    setPlaylists([]);
    setLive(new Map());
    setTakeout(emptyTakeoutSet());
    setMatches(new Map());
    keptRef.current = new Map();
    setStep('connect');
  };

  // ------------------------------------------------------------------ render

  const followed = useMemo(() => importItems(items), [items]);
  const counts = useMemo(() => progressCounts(followed, live), [followed, live]);
  const done = !!current && (current.status === 'finished' || (current.status === 'importing' && followed.length > 0 && isSettled(followed, live)));
  const waitingForFiles = step === 'import' && !!current && current.status === 'importing' && followed.some((i) => needsUpload(i) && !takeout.sources.has(keyOfMatch(i.match!)));
  const contentHref = `/${locale}/studio/${encodeURIComponent(channelId)}/content/videos`;

  return (
    <div className="yt-import" data-testid="studio-youtube">
      <header className="yt-hero mb-6">
        <div className="yt-hero-marks" aria-hidden="true">
          <span className="yt-hero-from"><YoutubeMark className="h-6 w-6" /></span>
          <ArrowRight className="yt-hero-arrow h-5 w-5 rtl:-scale-x-100" />
          {/* The owner's app icon as it is (resized only; wiki "App favicons") */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="yt-hero-to" src="/icon-192.png" alt="" width={48} height={48} data-testid="yt-hero-app-icon" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl" data-testid="yt-title">{text.title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{text.intro}</p>
        </div>
      </header>

      {load === 'loading' && (
        <div className="space-y-3" aria-busy="true" data-testid="yt-loading">
          <Skeleton className="h-8 w-full max-w-xl" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {load === 'failed' && (
        <div className="yt-panel text-center" data-testid="yt-load-failed">
          <p role="alert" className="mb-4 text-foreground">{loadError}</p>
          <Button className="min-h-11" onClick={() => window.location.reload()}>{text.errors.retry}</Button>
        </div>
      )}

      {load === 'ready' && view?.ready && (
        <>
          <Stepper step={step} />
          {notice && step === 'connect' && <p role="status" className="yt-ok mb-4 rounded-md p-3 text-sm" data-testid="yt-notice">{notice}</p>}

          {step === 'connect' && (
            <ConnectStep
              ref={headingRef}
              captionsAvailable={view.captionsAvailable}
              captions={captions}
              onCaptions={setCaptions}
              connecting={connecting}
              onConnect={() => void connect()}
              listing={current?.status === 'listing' ? current : null}
              error={connectError}
            />
          )}
          {step === 'pick' && (
            <PickStep
              ref={headingRef}
              locale={locale}
              items={items}
              playlists={playlists}
              selected={selected}
              onSelected={setSelected}
              selectedPlaylists={selectedPlaylists}
              onSelectedPlaylists={setSelectedPlaylists}
              visibilityMode={visibilityMode}
              onVisibilityMode={setVisibilityMode}
              saving={saving}
              error={stepError}
              onNext={() => void toFiles()}
            />
          )}
          {step === 'files' && (
            <FilesStep
              ref={headingRef}
              takeout={takeout}
              reading={reading}
              onAdd={(files) => void addFiles(files)}
              onRemove={removeFile}
              matched={matchedCount}
              selected={selectedItems.length}
              onBack={() => setStep('pick')}
              onNext={() => {
                setStepError('');
                setStep('review');
              }}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              ref={headingRef}
              items={selectedItems}
              files={takeout.files}
              matches={matches}
              onMatch={setMatch}
              starting={saving}
              error={stepError}
              onBack={() => setStep('files')}
              onStart={() => void start()}
            />
          )}
          {step === 'import' && current && (
            <ImportStep
              ref={headingRef}
              locale={locale}
              current={current}
              items={followed}
              live={live}
              counts={counts}
              done={done}
              retrying={retrying}
              onRetry={(item) => void retry(item)}
              onReviewTerms={() => setTermsOpen(true)}
              termsPaused={termsPaused}
              onCancel={() => setConfirmCancel(true)}
              resume={waitingForFiles ? <div className="mb-5"><FilesStep takeout={takeout} reading={reading} onAdd={(files) => void addResumeFiles(files)} onRemove={(name) => setTakeout(removeTakeoutFile(takeout, name))} matched={0} selected={0} resume /></div> : null}
              channelHref={channelPath(locale, { id: channelId, handle: channelHandle })}
              contentHref={contentHref}
              shortUrl={(videoId) => shareLink({ kind: 'video', id: videoId }, `${window.location.origin}/${locale}/video/${encodeURIComponent(videoId)}`, { locale })}
              onDownloadCsv={() => void downloadCsv()}
              onNewImport={newImport}
              notice={notice}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onResult={(confirmed) => void onCancel(confirmed)}
        title={text.progress.cancelTitle}
        description={text.progress.cancelBody}
        confirmLabel={text.progress.cancelConfirm}
        cancelLabel={text.progress.cancelKeep}
        testId="yt-cancel-dialog"
      />
      <CreatorTermsDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        onAccepted={() => {
          setTermsPaused(false);
          uploaderRef.current?.resume();
        }}
      />
    </div>
  );
}
