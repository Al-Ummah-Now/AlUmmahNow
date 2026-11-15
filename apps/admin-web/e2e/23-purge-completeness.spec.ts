/**
 * Purge completeness on the local stack (#699, #700, #702): an admin delete hides the video's
 * notifications at once and a restore brings them back; the permanent purge erases the video's
 * custom thumbnails on image storage and its notifications, and a deleted post's images.
 *
 * Set-up the spec is not about goes through the stack's control API: the video and post records
 * (R2), the stored images (fake Bunny Storage), a viewer's notification row, and the purge request
 * (instead of "Delete permanently now", which needs a fresh step-up sign-in). The hourly cleanup
 * is then run as its cron would. Everything carries the run id, so the teardown finds what is left.
 */
import crypto from 'node:crypto';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { E2E_ENTITY_PREFIX, LOCAL_STACK, STACK_CONTROL_URL } from './support/env';
import { eraseRowsMentioning, runCron, stackR2, stackSql } from './support/local-stack';

const NOTIFICATIONS = 'al-ummah-now-notifications';
const SEARCH = 'al-ummah-now-search';
const hex = crypto.randomBytes(6).toString('hex');
const channelId = `${E2E_ENTITY_PREFIX}purge-ch-${hex}`;
const videoId = `${E2E_ENTITY_PREFIX}purge-v-${hex}`;
const postId = `${E2E_ENTITY_PREFIX}purge-p-${hex}`;
const viewerId = `${E2E_ENTITY_PREFIX}purge-viewer-${hex}`;
const thumbnails = [`thumbnails/${videoId}/first.jpg`, `thumbnails/${videoId}/second.jpg`];
const postImage = `community-posts/${channelId}/${hex}.webp`;
const IMG = 'https://images.alummahnow.net';

const image = (path: string, method: 'GET' | 'PUT' = 'GET') =>
  fetch(`${STACK_CONTROL_URL}/__fake/images/${path}`, { method, ...(method === 'PUT' ? { body: 'image', headers: { 'content-type': 'image/jpeg' } } : {}) });
const hiddenAt = async () => (await stackSql<{ hidden_at: number | null }>(NOTIFICATIONS, `SELECT hidden_at FROM notifications WHERE id = '${hex}'`))[0];
/** Queues the purge as "Delete permanently now" does, then runs the hourly cleanup. */
async function purge(kind: 'video' | 'post', id: string) {
  await stackSql(SEARCH, `UPDATE admin_deletions SET purge_requested_at = '${new Date().toISOString()}', purge_requested_by = 'e2e' WHERE kind = '${kind}' AND target_id = '${id}'`);
  await runCron('api-videos', '47 * * * *');
}

test.describe.configure({ mode: 'serial' });

test.describe('purge completeness', () => {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(!LOCAL_STACK, 'Seeds R2 and image storage through the local stack');
    test.skip(testInfo.project.name !== 'chromium', 'One project: the API flow does not depend on the browser');
    const at = new Date().toISOString();
    expect((await stackR2('PUT', 'videos', videoId, { id: videoId, title: `E2E purge ${hex}`, userId: viewerId, channelId, dateCreated: at, dateModified: at, thumbnailUrl: `${IMG}/${thumbnails[1]}`, comments: [], likes: [] })).ok).toBe(true);
    expect((await stackR2('PUT', 'community-posts', `posts/${channelId}/${postId}.json`, { id: postId, channelId, userId: viewerId, type: 'image', content: `E2E purge ${hex}`, status: 'published', images: [{ url: `${IMG}/${postImage}` }], createdAt: at, updatedAt: at })).ok).toBe(true);
    for (const path of [...thumbnails, postImage]) expect((await image(path, 'PUT')).status).toBe(201);
    await stackSql(
      NOTIFICATIONS,
      `INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, entity_id, created_at) VALUES ('${hex}', '${viewerId}', 'uploads', 'new_video', 'newVideo', '{}', '${videoId}', ${Date.now()})`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    // Whatever step the run stopped at
    await stackR2('DELETE', 'videos', videoId);
    await stackR2('DELETE', 'community-posts', `posts/${channelId}/${postId}.json`);
    await stackSql(NOTIFICATIONS, `DELETE FROM notifications WHERE id = '${hex}'`);
    // Search-side rows the record writes left (the privacy footprint of the seeded owner, the
    // IndexNow ping a removed URL keeps by design): ours carry the hex, nothing else does
    for (const table of ['privacy_footprints', 'privacy_footprint_sigs', 'indexnow_pending']) await eraseRowsMentioning(SEARCH, table, [hex]);
  });

  test('PURGE-01 a deleted video\'s notifications are hidden at once and come back on restore', async () => {
    expect((await adminApi(`/api/content/videos/${videoId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e purge' }) })).status).toBe(200);
    expect((await hiddenAt())?.hidden_at).toEqual(expect.any(Number));
    expect((await adminApi(`/api/content/deletions/video/${videoId}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await hiddenAt())?.hidden_at).toBeNull();
  });

  test('PURGE-02 the purge erases the video\'s thumbnails on image storage and its notifications', async () => {
    expect((await adminApi(`/api/content/videos/${videoId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e purge' }) })).status).toBe(200);
    await purge('video', videoId);
    // The purge is an admin job on the queue
    await expect.poll(async () => (await stackR2('GET', 'videos', videoId)).status, { timeout: 30_000 }).toBe(404);
    for (const path of thumbnails) await expect.poll(async () => (await image(path)).status, { timeout: 30_000 }).toBe(404);
    await expect.poll(async () => (await stackSql(NOTIFICATIONS, `SELECT id FROM notifications WHERE id = '${hex}'`)).length, { timeout: 30_000 }).toBe(0);
  });

  test('PURGE-03 the purge of a deleted post erases its images', async () => {
    expect((await adminApi(`/api/content/posts/${channelId}/${postId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'e2e purge' }) })).status).toBe(200);
    await purge('post', postId);
    await expect.poll(async () => (await stackR2('GET', 'community-posts', `posts/${channelId}/${postId}.json`)).status, { timeout: 30_000 }).toBe(404);
    expect((await image(postImage)).status).toBe(404);
  });
});
