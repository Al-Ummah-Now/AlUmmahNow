/**
 * Dislikes are turned off: video dislikes since 2026-11-11, comment dislikes
 * since 2026-11-12 (owner decisions). The API's public contract marks the
 * matching POST route deprecated, and web and API deploy together, so a build
 * without the change still shows the dislike control.
 *
 * Only a PR run (against QA, which follows main) may meet such a build: there
 * the check is skipped with a `not-deployed` annotation. Stage and the nightly
 * runs always check.
 */
import { target } from './targets';

export const VIDEO_DISLIKES = '/api/v1/videos/{id}/dislikes';
export const COMMENT_DISLIKES = '/api/v1/videos/{id}/comments/{cid}/dislikes';

export async function dislikesTurnedOff(contractPath: string): Promise<boolean> {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return true;
  const res = await fetch(`${target().api}/api/openapi.json`).catch(() => null);
  if (!res?.ok) return true;
  const doc = await res.json().catch(() => null) as { paths?: Record<string, { post?: { deprecated?: boolean } }> } | null;
  return doc?.paths?.[contractPath]?.post?.deprecated === true;
}
