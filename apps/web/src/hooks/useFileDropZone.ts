'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';

/**
 * Drag-and-drop of a file onto a zone (thumbnail pickers).
 *
 * A zone is only a drop target when its `dragover` is cancelled; without that the browser
 * ignores the drop on it and, for a drop anywhere, opens the file in place of the page.
 * This hook cancels `dragover`/`drop` on the zone, keeps a drag-over state that does not
 * flicker over child elements, and, while mounted, makes file drops outside the zone
 * do nothing (no navigation to the image).
 */

type DataTransferLike = Pick<DataTransfer, 'types' | 'files'> | null | undefined;

/** Whether a drag carries files (during dragover only `types` says so; `files` is empty until drop). */
export function dragHasFiles(dt: DataTransferLike): boolean {
  if (!dt) return false;
  if (Array.from(dt.types ?? []).includes('Files')) return true;
  return (dt.files?.length ?? 0) > 0;
}

/** The first dropped file, or null (a drop of text or a link). */
export function firstDroppedFile(dt: DataTransferLike): File | null {
  return dt?.files?.[0] ?? null;
}

export interface FileDropZoneOptions {
  /** Called with the first dropped file */
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function useFileDropZone({ onFile, disabled = false }: FileDropZoneOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them so the state does not flicker
  const depth = useRef(0);

  // A file dropped outside a zone must not replace the page with the image
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.defaultPrevented || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      depth.current = 0;
      setIsDragOver(false);
    }
  }, [disabled]);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }, [disabled]);

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsDragOver(false);
  }, []);

  const onDrop = useCallback((e: ReactDragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    const file = firstDroppedFile(e.dataTransfer);
    if (file) onFile(file);
  }, [disabled, onFile]);

  return { isDragOver, dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
