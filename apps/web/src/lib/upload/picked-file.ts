/**
 * What a file picked in the single uploader is: one this browser already
 * uploaded (finished), or one to upload (new, or unfinished and resumed when
 * the form is sent).
 *
 * Like the batch uploader, a finished file picked again is never silently
 * uploaded as a second video: the uploader shows "Already uploaded" with a
 * link to it, and creates a new video only when the user asks for one.
 */

import type { ReauthoriseResult } from './resilient-tus';
import { findRememberedUpload, forgetUpload } from './resume-store';

type FileIdentity = Pick<File, 'name' | 'size' | 'lastModified'>;

export type PickedFile = { kind: 'uploaded'; videoId: string } | { kind: 'upload' };

export interface PickedFileDeps {
  /** GET /api/videos/upload/resume/:id (resilient-tus.ts requestUploadResume) */
  resume: (videoId: string) => Promise<ReauthoriseResult>;
  find?: typeof findRememberedUpload;
  forget?: typeof forgetUpload;
}

export async function checkPickedFile(file: FileIdentity, channelId: string, deps: PickedFileDeps): Promise<PickedFile> {
  const find = deps.find ?? findRememberedUpload;
  const forget = deps.forget ?? forgetUpload;
  const remembered = find(file, channelId);
  if (!remembered) return { kind: 'upload' };
  let answer: ReauthoriseResult;
  try {
    answer = await deps.resume(remembered.videoId);
  } catch {
    // Unknown for now: the form's own resume check runs again when it is sent
    return { kind: 'upload' };
  }
  if (answer.kind === 'completed') return { kind: 'uploaded', videoId: remembered.videoId };
  // Gone (deleted, abandoned): nothing to link to or resume
  if (answer.kind === 'gone') forget(file, channelId);
  return { kind: 'upload' };
}
