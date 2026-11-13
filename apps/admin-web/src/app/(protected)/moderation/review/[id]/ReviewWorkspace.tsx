'use client';

/**
 * The review screen (docs/specs/VIDEO-REVIEW.md §7). Keyboard first: N jumps to the next flag;
 * every flag is a button that seeks the player. Possible NSFW is blurred by default and shown one
 * item at a time with a button (never hover); every reveal is audited. Arabic text is dir="auto".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { REVIEW_REASON_CODES } from '@al-ummah/shared-types';
import { VideoPlayer } from '../../../videos/[id]/VideoPlayer';
import { claimReview, decideReview, revealReviewItem, type ReviewDetailView, type ReviewFindingView } from '@/lib/api/review';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

const SPEEDS = [1, 1.5, 2, 3];
const NSFW = new Set(['sexual', 'gore', 'disturbing', 'sexual_explicit_language', 'S12', 'minor_present']);

function clock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

interface Props {
  detail: ReviewDetailView;
  media: { playUrl: string | null; videoUrl: string | null; poster: string | null };
}

export function ReviewWorkspace({ detail, media }: Props) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { review, findings, subject } = detail;
  const playerBox = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(1);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [playerShown, setPlayerShown] = useState(!review.nsfw);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const timed = useMemo(() => findings.filter((f) => f.at_ms !== null).sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0)), [findings]);
  const frames = findings.filter((f) => (f.source === 'frame' || f.source === 'thumbnail' || f.source === 'image') && f.media_key);
  const transcript = findings.filter((f) => f.source === 'transcript');
  const metadata = findings.filter((f) => f.source === 'metadata');

  const video = () => playerBox.current?.querySelector('video') ?? null;
  const seek = useCallback((ms: number | null) => {
    const el = playerBox.current?.querySelector('video');
    if (!el || ms === null) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = video();
    if (el) el.playbackRate = speed;
  }, [speed, playerShown]);

  // N: the next flag after the current time
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const now = (playerBox.current?.querySelector('video')?.currentTime ?? 0) * 1000;
      const next = timed.find((f) => (f.at_ms ?? 0) > now + 500) ?? timed[0];
      if (next) seek(next.at_ms);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timed, seek]);

  const reveal = async (key: string, target: string) => {
    setRevealed((s) => new Set(s).add(key));
    const r = await revealReviewItem(review.id, target);
    if (!r.ok) logger.warn('[review] Reveal not audited', { reviewId: review.id, status: r.status });
  };

  const decide = async (decision: 'approve' | 'reject' | 'escalate' | 'undo') => {
    setBusy(true);
    setMessage(null);
    const r = await decideReview(review.id, decision, decision === 'reject' ? reason : undefined, note.trim() || undefined, locale === 'ar' ? 'ar' : 'en');
    setBusy(false);
    if (!r.ok) {
      logger.warn('[review] Decision failed', { reviewId: review.id, decision, status: r.status });
      setMessage({ kind: 'error', text: r.error || t('review.failed') });
      return;
    }
    setMessage({ kind: 'ok', text: t('review.decided', { decision: t(`review.${decision === 'undo' ? 'undo' : decision}`) }) });
    router.refresh();
  };

  const open = ['in_review', 'appealed', 'post_review', 'checking'].includes(review.status);
  const canUndo = !!review.decided_at && !!review.undo_until && new Date(review.undo_until).getTime() > Date.now();

  const flagButton = (f: ReviewFindingView) => (
    <button type="button" onClick={() => seek(f.at_ms)} className="text-link underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-focus rounded" aria-label={t('review.jumpTo', { time: clock(f.at_ms) })}>
      {clock(f.at_ms)}
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className={cardClass} data-testid="review-player">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-fg" dir="auto">{subject?.title || review.subject_id}</h1>
            <div className="flex items-center gap-1" role="group" aria-label={t('review.speed')}>
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={`rounded border px-2 py-1 text-sm ${speed === s ? 'border-accent bg-accent text-on-accent' : 'border-border text-fg'}`} data-testid={`review-speed-${s}`}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
          {playerShown ? (
            <div ref={playerBox}>
              <VideoPlayer playUrl={media.playUrl} videoUrl={media.videoUrl} poster={null} title={subject?.title ?? review.subject_id} />
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded bg-surface-2" data-testid="review-player-blurred">
              <p className="text-fg-muted">{t('review.blurred')}</p>
              <button type="button" className={secondaryButtonClass} onClick={() => { setPlayerShown(true); void revealReviewItem(review.id, 'player'); }}>{t('review.reveal')}</button>
            </div>
          )}
          {timed.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted" data-testid="review-markers">
              <span>{t('review.nextFlag')}:</span>
              {timed.slice(0, 40).map((f) => (
                <span key={f.id} data-category={f.category}>{flagButton(f)}</span>
              ))}
            </p>
          )}
        </section>

        {frames.length > 0 && (
          <section className={cardClass} data-testid="review-frames">
            <h2 className="mb-3 font-semibold text-fg">{t('review.frames')}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {frames.slice(0, 40).map((f) => {
                const key = f.media_key as string;
                const nsfw = NSFW.has(f.category);
                const shown = !nsfw || revealed.has(key);
                return (
                  <li key={f.id} className="space-y-1">
                    <div className="relative overflow-hidden rounded border-2 border-danger-border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- streamed, never cached, not optimizable */}
                      <img src={key.startsWith('https://') ? key : `/api/review-media/${encodeURIComponent(review.id)}?key=${encodeURIComponent(key)}`} referrerPolicy="no-referrer" alt={`${f.category} ${clock(f.at_ms)}`} className={`aspect-video w-full object-cover ${shown ? '' : 'blur-xl'}`} />
                      {!shown && (
                        <button type="button" onClick={() => void reveal(key, `frame@${f.at_ms ?? 'thumb'}`)} className="absolute inset-0 m-auto h-fit w-fit rounded bg-surface px-3 py-1 text-sm text-fg" data-testid="review-reveal">
                          {t('review.reveal')}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted">
                      {f.category} · {f.score.toFixed(2)} {f.at_ms !== null ? <>· {flagButton(f)}</> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {transcript.length > 0 && (
          <section className={cardClass} data-testid="review-transcript">
            <h2 className="mb-3 font-semibold text-fg">{t('review.transcript')}</h2>
            <ul className="space-y-3">
              {transcript.map((f) => (
                <li key={f.id} className="rounded bg-surface-2 p-3">
                  <p className="mb-1 text-xs text-fg-muted">
                    {flagButton(f)} · {f.category} · {f.score.toFixed(2)} {f.quran_ref ? `· ${t('review.quranRef', { ref: f.quran_ref })}` : ''}
                  </p>
                  {f.quran_ref ? null : <p dir="auto" className="whitespace-pre-wrap text-fg">{f.text}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={cardClass} data-testid="review-metadata">
          <h2 className="mb-2 font-semibold text-fg">{t('review.metadata')}</h2>
          <p dir="auto" className="whitespace-pre-wrap text-fg">{subject?.description}</p>
          {metadata.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-fg-muted">
              {metadata.map((f) => <li key={f.id}>{f.category} · {f.score.toFixed(2)} {f.rationale ? `· ${f.rationale}` : ''}</li>)}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        <section className={cardClass} data-testid="review-reasons">
          <h2 className="mb-2 font-semibold text-fg">{t('review.reasons')}</h2>
          {findings.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('review.noFindings')}</p>
          ) : (
            <ul className="space-y-1 text-sm text-fg">
              {findings.slice(0, 12).map((f) => (
                <li key={f.id}>{f.source} · {f.category} · {f.score.toFixed(2)} {f.at_ms !== null ? <>· {flagButton(f)}</> : null}</li>
              ))}
            </ul>
          )}
          {review.appeal_message && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-fg">{t('review.appealMessage')}</h3>
              <p dir="auto" className="whitespace-pre-wrap text-sm text-fg">{review.appeal_message}</p>
            </div>
          )}
        </section>

        <section className={`${cardClass} space-y-3`} data-testid="review-decision">
          <h2 className="font-semibold text-fg">{t('review.decisionTitle')}</h2>
          {message && (message.kind === 'error' ? <ErrorAlert testId="review-decision-error">{message.text}</ErrorAlert> : <p role="status" className="text-sm text-fg">{message.text}</p>)}
          {open && (
            <>
              <label className="block text-sm text-fg" htmlFor="review-reason">{t('review.reason')}</label>
              <select id="review-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldClass} w-full`}>
                <option value="">—</option>
                {Object.keys(REVIEW_REASON_CODES).map((code) => <option key={code} value={code}>{translateDynamic(t, 'review.reasonCodes', code)}</option>)}
              </select>
              <label className="block text-sm text-fg" htmlFor="review-note">{t('review.note')}</label>
              <textarea id="review-note" dir="auto" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} w-full`} />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void decide('approve')} className={primaryButtonClass} data-testid="review-approve">{t('review.approve')}</button>
                <button type="button" disabled={busy || !reason} onClick={() => void decide('reject')} className={secondaryButtonClass} data-testid="review-reject">{t('review.reject')}</button>
              </div>
              {!review.escalate && <button type="button" disabled={busy} onClick={() => void decide('escalate')} className={secondaryButtonClass} data-testid="review-escalate">{t('review.escalate')}</button>}
              {!review.assigned_to && <button type="button" disabled={busy} onClick={() => void claimReview(review.id).then(() => router.refresh())} className={secondaryButtonClass}>{t('review.claim')}</button>}
            </>
          )}
          {canUndo && <button type="button" disabled={busy} onClick={() => void decide('undo')} className={secondaryButtonClass} data-testid="review-undo">{t('review.undo')}</button>}
        </section>
      </aside>
    </div>
  );
}
