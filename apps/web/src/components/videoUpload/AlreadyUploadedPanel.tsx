'use client';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';

interface AlreadyUploadedPanelProps {
  fileName: string;
  videoId: string;
  className?: string;
  /** Upload the same file again as a new video (asked for, never by default) */
  onUploadAgain: () => void;
  onChooseAnother: () => void;
}

/**
 * The single uploader's answer to a file this browser already uploaded: the
 * video it became, and an explicit choice to upload it again as a new one
 * (the batch uploader marks such a row "Already uploaded" the same way).
 */
export function AlreadyUploadedPanel({ fileName, videoId, className = '', onUploadAgain, onChooseAnother }: AlreadyUploadedPanelProps) {
  const { t, lang } = useLanguage();
  return (
    <section
      className={`bg-[var(--fanous-color-surface-raised)] rounded-lg p-6 shadow-lg ${className}`}
      data-testid="upload-already-uploaded"
      aria-labelledby="upload-already-uploaded-title"
    >
      <h3 id="upload-already-uploaded-title" className="text-lg font-semibold text-[var(--fanous-color-text-primary)]">
        {t.batch.alreadyUploaded}
      </h3>
      <p className="mt-1 text-sm text-[var(--fanous-color-text-secondary)]" data-testid="upload-already-uploaded-hint">
        <span className="font-medium break-all" dir="auto">{fileName}</span> · {t.upload.alreadyUploadedHint}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={`/${lang}/video/${videoId}`} className="b b-primary" data-testid="upload-already-uploaded-view">
          {t.batch.viewVideo}
        </Link>
        <button type="button" className="b" onClick={onUploadAgain} data-testid="upload-again-as-new">
          {t.upload.uploadAgainAsNew}
        </button>
        <button type="button" className="b" onClick={onChooseAnother} data-testid="upload-choose-another">
          {t.upload.chooseAnotherFile}
        </button>
      </div>
    </section>
  );
}
