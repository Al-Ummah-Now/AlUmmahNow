'use server';

/**
 * Server actions for platform content management (channels, videos, comments,
 * playlists, community posts and videos users), over admin-api /api/content/*.
 * Reads throw (the pages show an error); changes return an ActionResult so the
 * client can show what went wrong.
 */
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';
import type {
  AdminChannelRow,
  AdminCommentRow,
  AdminContentPermission,
  AdminDeletionKind,
  AdminDeletionPage,
  AdminPage,
  AdminPlaylistRow,
  AdminPostRow,
  AdminUserRow,
  AdminUserSearchItem,
  AdminVideoRow,
  ChannelDetailView,
  ContentAuditEntry,
  AdminJob,
  CursorPage,
  JobCounts,
  JobResult,
  ListParams,
  UserDetailView,
  VideoDetailView,
} from './content-types';

const BASE = '/api/content';
const enc = encodeURIComponent;

function withQuery(path: string, params: ListParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return `${BASE}${path}${query ? `?${query}` : ''}`;
}

const reasonBody = (reason?: string) => ({ reason: reason?.trim() || undefined });
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

// Permissions and history

export async function getContentPermissions(): Promise<AdminContentPermission[]> {
  return (await fetchAdmin<{ permissions: AdminContentPermission[] }>(`${BASE}/permissions`)).permissions;
}

export async function getContentAudit(limit = 20): Promise<ContentAuditEntry[]> {
  return (await fetchAdmin<{ entries: ContentAuditEntry[] }>(withQuery('/audit', { limit }))).entries;
}

// Channels

export async function listChannels(params: ListParams): Promise<AdminPage<AdminChannelRow>> {
  return fetchAdmin(withQuery('/channels', params));
}

export async function getChannel(id: string): Promise<ChannelDetailView> {
  return fetchAdmin(`${BASE}/channels/${enc(id)}`);
}

export async function updateChannel(id: string, edit: { name?: string; handle?: string; description?: string }): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/channels/${enc(id)}`, json('PATCH', edit)));
}

export async function uploadChannelImage(id: string, kind: 'avatar' | 'cover', form: FormData): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/channels/${enc(id)}/images/${kind}`, { method: 'POST', body: form }));
}

/** Verification reuses the existing channel verification endpoint (its own audit log). */
export async function setChannelVerified(id: string, verified: boolean, note?: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`/api/channels/${enc(id)}/verification`, json('PUT', { verified, ...(note ? { note } : {}) })));
}

export async function suspendChannel(id: string, reason: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/channels/${enc(id)}/suspend`, json('POST', { reason: reason || undefined })));
}

export async function unsuspendChannel(id: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/channels/${enc(id)}/unsuspend`, json('POST')));
}

export async function transferChannel(id: string, newOwnerId: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/channels/${enc(id)}/transfer`, json('POST', { newOwnerId })));
}

/**
 * The transfer's new-owner picker: users matching an email, name, @handle or
 * id, without the current owner, each with their channel count and role on
 * this channel. Super admins only (admin-api checks channels:transfer).
 */
export async function searchTransferCandidates(channelId: string, q: string, exclude: string[]): Promise<ActionResult<{ items: AdminUserSearchItem[] }>> {
  const query = new URLSearchParams({ q, channelId });
  if (exclude.length) query.set('exclude', exclude.join(','));
  return toResult(() => fetchAdmin<{ items: AdminUserSearchItem[] }>(`${BASE}/users/search?${query}`));
}

/** One job's current state, for following an action's job from the page that started it. */
export async function readJob(id: string): Promise<ActionResult<AdminJob>> {
  return toResult(() => fetchAdmin<AdminJob>(`${BASE}/jobs/${enc(id)}`));
}

/** Soft delete (restorable for 30 days under Recently deleted). */
export async function deleteChannel(id: string, reason?: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/channels/${enc(id)}`, json('DELETE', reasonBody(reason))));
}

// Videos

export async function listVideos(params: ListParams): Promise<AdminPage<AdminVideoRow>> {
  return fetchAdmin(withQuery('/videos', params));
}

export async function getVideo(id: string): Promise<VideoDetailView> {
  return fetchAdmin(`${BASE}/videos/${enc(id)}`);
}

export async function updateVideo(id: string, edit: { title?: string; description?: string; isPublic?: boolean }): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/videos/${enc(id)}`, json('PATCH', edit)));
}

export async function uploadVideoThumbnail(id: string, form: FormData): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/videos/${enc(id)}/thumbnail`, { method: 'POST', body: form }));
}

export async function moveVideo(id: string, channelId: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/videos/${enc(id)}/move`, json('POST', { channelId })));
}

export async function videoAction(id: string, action: 'unpublish' | 'republish' | 'reprocess'): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/videos/${enc(id)}/${action}`, json('POST')));
}

/** Soft delete (restorable for 30 days under Recently deleted). */
export async function deleteVideo(id: string, reason?: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/videos/${enc(id)}`, json('DELETE', reasonBody(reason))));
}

// Comments, playlists, community posts

export async function listComments(params: ListParams): Promise<AdminPage<AdminCommentRow>> {
  return fetchAdmin(withQuery('/comments', params));
}

export async function deleteComment(videoId: string, commentId: string, reason?: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/videos/${enc(videoId)}/comments/${enc(commentId)}`, json('DELETE', reasonBody(reason))));
}

export async function listPlaylists(params: ListParams): Promise<CursorPage<AdminPlaylistRow>> {
  return fetchAdmin(withQuery('/playlists', params));
}

export async function deletePlaylist(id: string, reason?: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/playlists/${enc(id)}`, json('DELETE', reasonBody(reason))));
}

export async function listPosts(params: ListParams): Promise<CursorPage<AdminPostRow>> {
  return fetchAdmin(withQuery('/posts', params));
}

export async function deletePost(channelId: string, postId: string, reason?: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/posts/${enc(channelId)}/${enc(postId)}`, json('DELETE', reasonBody(reason))));
}

// Users (videos profiles; never the Auth account)

export async function listUsers(params: ListParams): Promise<AdminPage<AdminUserRow>> {
  return fetchAdmin(withQuery('/users', params));
}

export async function getUser(id: string): Promise<UserDetailView> {
  return fetchAdmin(`${BASE}/users/${enc(id)}`);
}

export async function updateUser(id: string, edit: { displayName?: string; userName?: string; bio?: string }): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/users/${enc(id)}`, json('PATCH', edit)));
}

export async function banUser(id: string, reason: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/users/${enc(id)}/ban`, json('POST', { reason: reason || undefined })));
}

export async function unbanUser(id: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/users/${enc(id)}/unban`, json('POST')));
}

/** Soft-deletes the user's videos data (hidden now, erased by the 30-day cleanup); the ban, if any, is kept. */
export async function deleteUserData(id: string, reason?: string): Promise<ActionResult<JobResult>> {
  return toResult(() => fetchAdmin<JobResult>(`${BASE}/users/${enc(id)}/delete-data`, json('POST', reasonBody(reason))));
}

// Recently deleted (soft deletes: restorable for 30 days, then purged by the cleanup)

export async function listDeletions(params: { kind?: AdminDeletionKind; cursor?: string; pageSize?: number }): Promise<AdminDeletionPage> {
  return fetchAdmin(withQuery('/deletions', params as ListParams));
}

export async function restoreDeletion(kind: AdminDeletionKind, id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/deletions/${enc(kind)}/${enc(id)}/restore`, json('POST', {})));
}

/** "Delete permanently now": queues it for the next cleanup run (still restorable until then). */
export async function requestPermanentDeletion(kind: AdminDeletionKind, id: string): Promise<ActionResult<unknown>> {
  return toResult(() => fetchAdmin(`${BASE}/deletions/${enc(kind)}/${enc(id)}/purge`, json('POST', {})));
}

// Admin jobs (heavy actions run from a queue; failed ones wait here for Retry)

export async function listJobs(params: ListParams): Promise<AdminJob[]> {
  return (await fetchAdmin<{ items: AdminJob[] }>(withQuery('/jobs', params))).items;
}

export async function getJob(id: string): Promise<AdminJob> {
  return fetchAdmin(`${BASE}/jobs/${enc(id)}`);
}

export async function getJobCounts(): Promise<JobCounts> {
  return fetchAdmin(`${BASE}/jobs/counts`);
}

export async function retryJob(id: string): Promise<ActionResult<AdminJob>> {
  return toResult(() => fetchAdmin<AdminJob>(`${BASE}/jobs/${enc(id)}/retry`, json('POST')));
}
