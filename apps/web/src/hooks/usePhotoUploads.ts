'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UploadJob {
  next: File | null;
}

interface Slot {
  /** The last thing queued for this photo, when it is an upload not done yet: a new pick only replaces its file */
  lastUpload: UploadJob | null;
  /** Upload jobs queued or running */
  jobs: number;
  /** Everything done to this photo (uploads, removals), one after the other, in the order asked */
  tail: Promise<void>;
}

/**
 * Photo uploads of an edit form, one at a time per photo (avatar, cover).
 *
 * The form stays usable while a photo uploads: the new photo shows at once (`previews`), and
 * another one picked meanwhile waits for the upload that is running, so the last pick is always
 * the one the server keeps (two uploads at the same time could finish in either order). A photo
 * replaced before its turn is never sent. Other changes to the same photo (Remove) go through `run`, in
 * the same line, so a removal and an upload never race.
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

  const slot = (key: K): Slot => (slots.current[key] ??= { lastUpload: null, jobs: 0, tail: Promise.resolve() });

  const start = useCallback(
    (key: K, file: File): Promise<void> => {
      const line = slot(key);
      preview(key, file);
      if (line.lastUpload) {
        line.lastUpload.next = file;
        return line.tail;
      }
      const job: UploadJob = { next: file };
      line.lastUpload = job;
      line.jobs++;
      setUploading((u) => ({ ...u, [key]: true }));
      const upload = async () => {
        try {
          while (job.next) {
            const sending = job.next;
            job.next = null;
            await latest.current(key, sending);
          }
        } finally {
          if (line.lastUpload === job) line.lastUpload = null;
          if (--line.jobs === 0) {
            // The saved photo shows from here on (or the previous one, when the upload failed)
            preview(key, null);
            setUploading((u) => ({ ...u, [key]: false }));
          }
        }
      };
      const done = line.tail.then(upload);
      line.tail = done.catch(() => undefined);
      return done;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot reads a ref
    [preview],
  );

  /** Runs another change to this photo (a removal) after what is already queued for it. */
  const run = useCallback(<T,>(key: K, task: () => Promise<T>): Promise<T> => {
    const line = slot(key);
    // A photo picked from now on goes after this
    line.lastUpload = null;
    const done = line.tail.then(task);
    line.tail = done.then(() => undefined, () => undefined);
    return done;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot reads a ref
  }, []);

  return { start, run, uploading, previews };
}
