'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, CheckCircle2, Loader2, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { ProcessingPhase } from '@/lib/upload/processing-status';
import '@/theme/upload-status.css';

interface UploadProcessingCardProps {
  videoId: string;
  title: string;
  phase: ProcessingPhase;
  onUploadAnother: () => void;
}

type StepState = 'done' | 'current' | 'todo' | 'failed';

/**
 * Shown once a single upload's bytes are uploaded: says the upload is done and
 * the video is processing on the server, then follows it to Ready (with a
 * link to watch) or to "couldn't be processed" (with a link to edit it).
 * The uploader is notified by the server either way, so nothing here depends
 * on the tab staying open, but the card does not invite leaving either.
 */
export function UploadProcessingCard({ videoId, title, phase, onUploadAnother }: UploadProcessingCardProps) {
  const { t, lang } = useLanguage();
  const s = t.uploadStatus;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the result so keyboard and screen-reader users land on it
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const heading = phase === 'ready' ? s.readyTitle : phase === 'failed' ? s.failedTitle : s.completeTitle;
  const body = phase === 'ready' ? s.readyBody : phase === 'failed' ? s.failedBody : s.processingBody;
  const status =
    phase === 'ready'
      ? s.announceReady.replace('{title}', title)
      : phase === 'failed'
        ? s.announceFailed.replace('{title}', title)
        : s.steps.processing;

  const steps: Array<{ key: string; label: string; state: StepState }> = [
    { key: 'uploaded', label: s.steps.uploaded, state: 'done' },
    { key: 'processing', label: s.steps.processing, state: phase === 'processing' ? 'current' : phase === 'failed' ? 'failed' : 'done' },
    phase === 'failed'
      ? { key: 'failed', label: s.steps.failed, state: 'failed' }
      : { key: 'ready', label: s.steps.ready, state: phase === 'ready' ? 'done' : 'todo' },
  ];

  return (
    <section className="ups-card" data-testid="upload-success" data-video-id={videoId} data-phase={phase} aria-labelledby="ups-heading">
      <div className="ups-head">
        <span className="ups-badge" aria-hidden="true">
          {phase === 'failed' ? <AlertCircle /> : <CheckCircle2 />}
        </span>
        <div className="min-w-0">
          <h2 id="ups-heading" ref={headingRef} tabIndex={-1} className="ups-title" data-testid="upload-success-heading">
            {heading}
          </h2>
          <p className="ups-name" data-testid="upload-success-title">
            <bdi>{title}</bdi>
          </p>
          <p className="ups-body" data-testid="upload-processing-message">
            {body}
          </p>
        </div>
      </div>

      <ol className="ups-steps" aria-label={s.stepsLabel}>
        {steps.map((step) => (
          <li
            key={step.key}
            className="ups-step"
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="ups-dot" aria-hidden="true">
              {step.state === 'done' && <Check />}
              {step.state === 'current' && <Loader2 className="ups-spin" />}
              {step.state === 'failed' && <X />}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      {/* Announces Processing → Ready / Couldn't be processed as it changes */}
      <p className="ups-status" role="status" aria-live="polite" aria-atomic="true" data-testid="upload-processing-status" data-phase={phase}>
        {status}
      </p>

      <div className="ups-actions">
        {phase === 'ready' && (
          <Link href={`/${lang}/video/${videoId}`} className="b b-primary" data-testid="upload-view-video">
            {s.viewVideo}
          </Link>
        )}
        {phase === 'failed' && (
          <Link href={`/${lang}/studio/video/${videoId}/edit`} className="b b-primary" data-testid="upload-edit-video">
            {s.editVideo}
          </Link>
        )}
        <button type="button" className="b b-secondary" data-testid="upload-another" onClick={onUploadAnother}>
          {s.uploadAnother}
        </button>
      </div>
    </section>
  );
}
