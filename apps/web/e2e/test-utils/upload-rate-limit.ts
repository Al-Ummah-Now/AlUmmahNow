/**
 * The local stack enforces the free tier's upload limits (api-videos middleware/rate-limit.ts:
 * image_upload is 2 a minute per user). A spec that uploads several images in a row would hit
 * that on its own, and the run accounts are shared across the specs of a shard (#1466: the
 * Arabic thumbnail drop got "You've reached the upload limit" after the English one).
 *
 * resetUploadLimit() clears this run account's windows for one operation before a test that
 * uploads, through the stack's SQL fast path. Local stack only: on QA it does nothing (the
 * deployed limits are real, and those suites run once per release).
 */
import { readSession, type AuthUser } from './auth-state';

const SEARCH_D1 = 'al-ummah-now-search';
const SAFE = /^[A-Za-z0-9_:.-]{1,128}$/;

function control(): string | null {
  if (process.env.E2E_ENV !== 'local') return null;
  const url = new URL(process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190');
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('LOCAL_STACK_CONTROL_URL must be a loopback URL');
  return url.origin;
}

export async function resetUploadLimit(user: AuthUser, operation: 'image_upload' | 'video_upload' = 'image_upload'): Promise<void> {
  const base = control();
  if (!base) return;
  const { userId } = readSession(user);
  if (!SAFE.test(userId) || !SAFE.test(operation)) throw new Error(`unsafe id for SQL: ${userId} ${operation}`);
  const where = `user_id = '${userId}' AND operation = '${operation}'`;
  for (const table of ['upload_rate_windows', 'upload_rate_leases']) {
    const res = await fetch(`${base}/__stack/d1/${SEARCH_D1}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: `DELETE FROM ${table} WHERE ${where}` });
    if (!res.ok) throw new Error(`reset ${operation} limit for ${user}: ${res.status} ${await res.text().catch(() => '')}`);
  }
}
