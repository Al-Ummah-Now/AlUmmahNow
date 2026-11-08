'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import {
  CROP_SPECS,
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  sourceRect,
  fitAspect,
  type CropKind,
  type Point,
  type Size,
} from '@/lib/image-crop';

interface ImageCropDialogProps {
  /** The picked file; the dialog is open while this is set. */
  file: File | null;
  kind: CropKind;
  onCancel: () => void;
  /** Receives the cropped JPEG, sized for the kind (800x800 avatar, 2560x640 cover). */
  onApply: (cropped: File) => void;
}

const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const ZOOM_STEP = 0.1;

/**
 * Lets the user position and zoom an avatar or cover before it is uploaded.
 * Drag (mouse/touch/pen), mouse wheel, zoom slider and keyboard
 * (arrows move, +/- zoom, 0 resets) are supported.
 */
/** Long side of the on-screen preview canvas, in pixels */
const PREVIEW_MAX = 2048;

export default function ImageCropDialog({ file, kind, onCancel, onApply }: ImageCropDialogProps) {
  const { t, isRTL } = useLanguage();
  const spec = CROP_SPECS[kind];
  // Decoded picked image. Drawn on canvases rather than shown through an
  // <img src>, so nothing from the file input ever becomes markup or a URL.
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Callback-ref state: the frame mounts inside the dialog portal after this
  // component's effects first run, so measure when the element itself appears.
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; start: Point; from: Point } | null>(null);

  // Decode the picked file
  useEffect(() => {
    setNatural(null);
    setFailed(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setBitmap(null);
    if (!file) return;
    let cancelled = false;
    let decoded: ImageBitmap | null = null;
    createImageBitmap(file)
      .then((b) => {
        if (cancelled) {
          b.close();
          return;
        }
        decoded = b;
        setBitmap(b);
        setNatural({ width: b.width, height: b.height });
      })
      .catch((error) => {
        logger.warn('[ImageCropDialog] Could not decode the picked image', { error, kind });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      decoded?.close();
    };
  }, [file, kind]);

  // Paint the preview (at most PREVIEW_MAX px on the long side; CSS sizes it)
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !bitmap) return;
    const ratio = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }, [bitmap, frameEl]);

  // Track the frame size (it is responsive)
  useLayoutEffect(() => {
    const el = frameEl;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameEl]);

  const measured = viewport.width > 0 && viewport.height > 0;
  const ready = !!natural && measured;
  const scale = ready ? coverScale(natural, viewport) * zoom : 1;

  const applyZoom = useCallback(
    (next: number) => {
      if (!natural) return;
      const z = clampZoom(next);
      const base = coverScale(natural, viewport);
      // Zoom around the frame centre: offsets scale with the image
      setOffset((o) => clampOffset({ x: (o.x * z) / zoom, y: (o.y * z) / zoom }, natural, viewport, base * z));
      setZoom(z);
    },
    [natural, viewport, zoom],
  );

  // Re-clamp when the frame resizes
  useEffect(() => {
    if (natural) setOffset((o) => clampOffset(o, natural, viewport, coverScale(natural, viewport) * zoom));
  }, [natural, viewport, zoom]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling
  useEffect(() => {
    const el = frameEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, zoom, frameEl]);

  const move = (dx: number, dy: number) => {
    if (!natural) return;
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, natural, viewport, scale));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, from: offset };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !natural) return;
    setOffset(
      clampOffset(
        { x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y },
        natural,
        viewport,
        scale,
      ),
    );
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    switch (e.key) {
      case 'ArrowLeft': move(step, 0); break;
      case 'ArrowRight': move(-step, 0); break;
      case 'ArrowUp': move(0, step); break;
      case 'ArrowDown': move(0, -step); break;
      case '+':
      case '=': applyZoom(zoom + ZOOM_STEP); break;
      case '-':
      case '_': applyZoom(zoom - ZOOM_STEP); break;
      case '0': reset(); break;
      default: return;
    }
    e.preventDefault();
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const apply = async () => {
    if (!bitmap || !natural || !file || !measured) return;
    setBusy(true);
    try {
      const { sx, sy, sw, sh } = fitAspect(sourceRect(natural, viewport, scale, offset), spec.output.width / spec.output.height);
      const canvas = document.createElement('canvas');
      canvas.width = spec.output.width;
      canvas.height = spec.output.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      // JPEG has no alpha: give transparent PNGs a white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not encode the cropped image');
      const name = `${file.name.replace(/\.[^.]+$/, '') || kind}.jpg`;
      onApply(new File([blob], name, { type: 'image/jpeg' }));
    } catch (error) {
      logger.error('[ImageCropDialog] Crop failed', { error, kind });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hintId = `image-crop-hint-${kind}`;
  const title = kind === 'avatar' ? t.imageCrop.avatarTitle : t.imageCrop.coverTitle;

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        className={kind === 'cover' ? 'sm:max-w-3xl' : 'sm:max-w-md'}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid={`image-crop-dialog-${kind}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id={hintId}>{t.imageCrop.hint}</DialogDescription>
        </DialogHeader>

        {failed ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="image-crop-error">
            {t.imageCrop.loadFailed}
          </p>
        ) : (
          <div
            ref={setFrameEl}
            // Geometry is physical (left/right), so keep the frame LTR in Arabic too
            dir="ltr"
            role="group"
            tabIndex={0}
            aria-label={t.imageCrop.previewLabel}
            aria-describedby={hintId}
            data-testid="image-crop-frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className={`relative mx-auto w-full overflow-hidden rounded-md bg-gray-900 touch-none select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${kind === 'avatar' ? 'max-w-xs' : ''}`}
            style={{ aspectRatio: String(spec.aspect) }}
          >
            {bitmap && (
              <canvas
                ref={previewRef}
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                style={
                  ready
                    ? {
                        width: natural.width * scale,
                        height: natural.height * scale,
                        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                      }
                    : { visibility: 'hidden' }
                }
              />
            )}
            {spec.round && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80"
                style={{ boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }}
              />
            )}
          </div>
        )}

        {!failed && (
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="icon" onClick={() => applyZoom(zoom - ZOOM_STEP)} aria-label={t.imageCrop.zoomOut} disabled={!natural || zoom <= MIN_ZOOM}>
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </Button>
            <label className="sr-only" htmlFor={`image-crop-zoom-${kind}`}>{t.imageCrop.zoom}</label>
            <input
              id={`image-crop-zoom-${kind}`}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => applyZoom(Number(e.target.value))}
              disabled={!natural}
              className="flex-1 accent-blue-600"
              data-testid="image-crop-zoom"
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => applyZoom(zoom + ZOOM_STEP)} aria-label={t.imageCrop.zoomIn} disabled={!natural || zoom >= MAX_ZOOM}>
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={!natural}>
              {t.imageCrop.reset}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t.imageCrop.cancel}
          </Button>
          <Button type="button" onClick={apply} disabled={busy || failed || !ready} data-testid="image-crop-apply">
            {t.imageCrop.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
