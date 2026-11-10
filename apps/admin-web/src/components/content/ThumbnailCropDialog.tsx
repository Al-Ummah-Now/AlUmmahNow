'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_ZOOM, aspectLabel, cropOutputSize, cropRect, panDelta, type ThumbnailCropSize } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { primaryButtonClass } from '@/components/ui';
import { smallButtonClass } from './parts';

const PAN_STEP = 0.1;

/** Reads an image file: its object URL (revoke when done) and pixel size. */
export function loadImageFile(file: File): Promise<{ url: string; size: ThumbnailCropSize }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, size: { width: img.naturalWidth, height: img.naturalHeight } });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image'));
    };
    img.src = url;
  });
}

/** The crop as a JPEG of the video's shape, longest edge 1280 (same aspect in and out: never stretched). */
async function renderCrop(img: HTMLImageElement, image: ThumbnailCropSize, video: ThumbnailCropSize, zoom: number, pan: { x: number; y: number }, filename: string): Promise<File> {
  const aspect = video.width / video.height;
  const rect = cropRect(image, aspect, zoom, pan.x, pan.y);
  const out = cropOutputSize(aspect);
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not encode the cropped image');
  return new File([blob], filename.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

interface Props {
  src: string;
  image: ThumbnailCropSize;
  video: ThumbnailCropSize;
  filename: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

/**
 * Crops an admin-picked thumbnail to the video's shape before upload (owner,
 * 2026-11-10: thumbnails never mismatch the video; the API refuses other
 * shapes with 422 thumbnail_shape). The frame has the video's aspect; drag or
 * the arrow keys move the picture, the slider zooms; the frame shows exactly
 * what is saved.
 */
export function ThumbnailCropDialog({ src, image, video, filename, onCancel, onConfirm }: Props) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const aspect = video.width / video.height;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  const clamp = (p: { x: number; y: number }) => ({ x: Math.max(-1, Math.min(1, p.x)), y: Math.max(-1, Math.min(1, p.y)) });
  const rect = cropRect(image, aspect, zoom, pan.x, pan.y);

  async function confirm() {
    if (!imgRef.current) return;
    setBusy(true);
    setFailed(false);
    try {
      onConfirm(await renderCrop(imgRef.current, image, video, zoom, pan, filename));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="thumb-crop-title"
      aria-describedby="thumb-crop-help"
      className="bg-surface text-fg border border-border rounded-lg p-0 w-[min(40rem,calc(100vw-2rem))] backdrop:bg-fg/50"
      data-testid="video-thumbnail-cropper"
    >
      <div className="p-6 space-y-4">
        <h2 id="thumb-crop-title" className="text-lg font-semibold">{t('videos.cropTitle')}</h2>
        <p id="thumb-crop-help" className="text-fg-muted text-sm">
          {t('videos.cropHelp', { image: `${image.width}×${image.height}`, video: aspectLabel(video) })}
        </p>
        <div className="flex justify-center">
          <div
            ref={frameRef}
            role="application"
            tabIndex={0}
            aria-label={t('videos.cropFrameLabel')}
            data-testid="video-thumbnail-crop-frame"
            data-aspect={aspect.toFixed(4)}
            className="relative overflow-hidden rounded border border-border bg-surface-2 cursor-move touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ aspectRatio: `${video.width} / ${video.height}`, width: aspect >= 1 ? '100%' : undefined, height: aspect < 1 ? 'min(60vh, 26rem)' : undefined }}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const width = frameRef.current?.getBoundingClientRect().width || 1;
              const d = panDelta(image, aspect, zoom, width, e.clientX - drag.current.x, e.clientY - drag.current.y);
              drag.current = { x: e.clientX, y: e.clientY };
              setPan((p) => clamp({ x: p.x + d.x, y: p.y + d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={(e) => {
              const moves: Record<string, [number, number]> = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] };
              const m = moves[e.key];
              if (!m) return;
              e.preventDefault();
              setPan((p) => clamp({ x: p.x + m[0], y: p.y + m[1] }));
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local image being cropped */}
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                maxWidth: 'none',
                width: `${(image.width / rect.sw) * 100}%`,
                height: `${(image.height / rect.sh) * 100}%`,
                left: `${(-rect.sx / rect.sw) * 100}%`,
                top: `${(-rect.sy / rect.sh) * 100}%`,
              }}
            />
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm text-fg-muted">
          <span>{t('videos.cropZoom')}</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-accent" data-testid="video-thumbnail-crop-zoom" />
        </label>
        {failed && <p role="alert" className="text-sm text-danger-fg">{t('videos.cropFailed')}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={smallButtonClass} onClick={() => ref.current?.close()} data-testid="video-thumbnail-crop-cancel">
            {t('content.cancel')}
          </button>
          <button type="button" className={`${primaryButtonClass} disabled:opacity-60`} disabled={busy} onClick={confirm} data-testid="video-thumbnail-crop-confirm">
            {t('videos.cropUse')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
