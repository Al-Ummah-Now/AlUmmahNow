'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Slot {
  running: boolean;
  next: File | null;
}

/**
 * Photo uploads of an edit form, one at a time per photo (avatar, cover).
 *
 * The form stays usable while a photo uploads: the new photo shows at once (`previews`), and
 * another one picked meanwhile waits for the upload that is running, so the last pick is always
 * the one the server keeps (two uploads at the same time could finish in either order). A photo
 * replaced before its turn is never sent.
 */
export function usePhotoUploads<K extends string>(upload: (key: K, file: File) => Promise<void>) {
  const [uploading, setUploading] = useState<Partial<Record<K, boolean>>>({});
  const [previews, setPreviews] = useState<Partial<Record<K, string>>>({});
  const slots = useRef<Partial<Record<K, Slot>>>({});
  const urls = useRef<Partial<Record<K, string>>>({});
  const latest = useRef(upload);
  useEffect(() => {
    latest.current = upload;
  });

  const preview = useCallback((key: K, file: File | null) => {
    const old = urls.current[key];
    const url = file ? URL.createObjectURL(file) : undefined;
    urls.current[key] = url;
    setPreviews((p) => ({ ...p, [key]: url }));
    if (old) URL.revokeObjectURL(old);
  }, []);

  useEffect(() => {
    const open = urls.current;
    return () => {
      for (const url of Object.values<string | undefined>(open)) if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const start = useCallback(
    async (key: K, file: File): Promise<void> => {
      const slot = (slots.current[key] ??= { running: false, next: null } as Slot);
      slot.next = file;
      preview(key, file);
      if (slot.running) return;
      slot.running = true;
      setUploading((u) => ({ ...u, [key]: true }));
      try {
        while (slot.next) {
          const sending = slot.next;
          slot.next = null;
          await latest.current(key, sending);
        }
      } finally {
        slot.running = false;
        // The saved photo shows from here on (or the previous one, when the upload failed)
        preview(key, null);
        setUploading((u) => ({ ...u, [key]: false }));
      }
    },
    [preview],
  );

  return { start, uploading, previews };
}
