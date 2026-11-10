'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { MAX_ZOOM, aspectLabel, cropOutputSize, cropRect, panDelta, type Size } from '@/lib/utils/thumbnailCrop';

interface ThumbnailCropperProps {
  /** The picked image (object URL or data URL) and its pixel size */
  src: string;
  image: Size;
  /** The video's size: the crop has its shape */
  video: Size;
  open: boolean;
  onCancel: () => void;
  /** The cropped image: video shape, longest edge 1280, JPEG */
  onConfirm: (file: File) => void;
  filename?: string;
}

const PAN_STEP = 0.1;

/** Draws the crop into a JPEG of the video's shape (never stretched: same aspect in and out). */
export async function renderCrop(img: HTMLImageElement, image: Size, video: Size, zoom: number, pan: { x: number; y: number }, filename = 'thumbnail.jpg'): Promise<File> {
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

/**
 * Crop a custom thumbnail to the video's shape (owner, 2026-11-10: thumbnails
 * never mismatch the video). The frame has the video's aspect; drag (or the
 * arrow keys) moves the picture, the slider zooms. What the frame shows is
 * exactly what is saved.
 */
export function ThumbnailCropper({ src, image, video, open, onCancel, onConfirm, filename }: ThumbnailCropperProps) {
  const { t } = useLanguage();
  const aspect = video.width / video.height;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // A new image starts centred
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFailed(false);
  }, [src]);

  const clampPan = (p: { x: number; y: number }) => ({ x: Math.max(-1, Math.min(1, p.x)), y: Math.max(-1, Math.min(1, p.y)) });

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const width = frameRef.current?.getBoundingClientRect().width || 1;
    const d = panDelta(image, aspect, zoom, width, e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
    setPan((p) => clampPan({ x: p.x + d.x, y: p.y + d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-PAN_STEP, 0], ArrowRight: [PAN_STEP, 0], ArrowUp: [0, -PAN_STEP], ArrowDown: [0, PAN_STEP] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPan((p) => clampPan({ x: p.x + m[0], y: p.y + m[1] }));
  };

  const confirm = useCallback(async () => {
    if (!imgRef.current) return;
    setBusy(true);
    setFailed(false);
    try {
      onConfirm(await renderCrop(imgRef.current, image, video, zoom, pan, filename));
    } catch (error) {
      logger.error('[ThumbnailCropper] Crop failed', { error: error instanceof Error ? error.message : String(error) });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [image, video, zoom, pan, filename, onConfirm]);

  // Position the picture so the frame shows exactly the crop rectangle
  const rect = cropRect(image, aspect, zoom, pan.x, pan.y);
  const imgStyle: React.CSSProperties = {
    position: 'absolute',
    width: `${(image.width / rect.sw) * 100}%`,
    height: `${(image.height / rect.sh) * 100}%`,
    left: `${(-rect.sx / rect.sw) * 100}%`,
    top: `${(-rect.sy / rect.sh) * 100}%`,
    maxWidth: 'none',
  };
  const help = (t.video.cropHelp ?? '')
    .replace('{image}', `${image.width}×${image.height}`)
    .replace('{video}', aspectLabel(video));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-2xl" data-testid="thumbnail-cropper">
        <DialogTitle>{t.video.cropTitle}</DialogTitle>
        <DialogDescription>{help}</DialogDescription>
        <div className="flex justify-center">
          <div
            ref={frameRef}
            role="application"
            tabIndex={0}
            aria-label={t.video.cropFrameLabel}
            data-testid="thumbnail-crop-frame"
            data-aspect={aspect.toFixed(4)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className="relative overflow-hidden rounded-lg border border-border bg-muted cursor-move touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ aspectRatio: `${video.width} / ${video.height}`, width: aspect >= 1 ? '100%' : undefined, height: aspect < 1 ? 'min(60vh, 28rem)' : undefined }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local image being cropped */}
            <img ref={imgRef} src={src} alt="" draggable={false} style={imgStyle} data-testid="thumbnail-crop-image" />
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span>{t.video.cropZoom}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            data-testid="thumbnail-crop-zoom"
            className="flex-1 accent-primary"
          />
        </label>
        {failed && <p role="alert" className="text-sm text-destructive">{t.video.thumbnailUploadFailed}</p>}
        <DialogFooter>
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm" data-testid="thumbnail-crop-cancel">
            {t.video.cropCancel}
          </button>
          <button type="button" onClick={confirm} disabled={busy} aria-busy={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" data-testid="thumbnail-crop-confirm">
            {t.video.cropUse}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Loads an image file: its URL (revoke when done) and pixel size. */
export function loadImageFile(file: File): Promise<{ url: string; size: Size }> {
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
