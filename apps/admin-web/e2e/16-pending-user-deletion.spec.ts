/**
 * A pending "Delete videos data" blocks the user's writes (#701), end to end
 * on QA:
 *   a run user (registered for this spec, never a seed) with a videos profile
 *   -> the admin deletes their videos data through admin-api
 *   -> they still sign in and read, every write and GET /api/profile answer 403
 *      `videos_account_pending_deletion`, /api/me/creator says pendingDeletion
 *   -> the admin restores it from Recently deleted -> writes work again at once.
 * Afterwards the user erases their own videos data (/api/privacy, allowed
 * throughout) and the workflow teardown deletes the account. No paid AI.
 *
 * Run mode only (its own account), one project (chromium).
 */
import crypto from 'node:crypto';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { RUN_ID, VIDEOS_API_URL, runAccountName, runPassword, runUserEmail } from './support/env';
import { registerSinkUser } from './support/run-accounts';
import { getAccessToken } from './support/oauth';

const CODE = 'videos_account_pending_deletion';

const subject: { id?: string; token?: string; deleted?: boolean } = {};

async function asUser(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${VIDEOS_API_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${subject.token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed };
}

/** Whether QA's api-videos has this change (its public contract documents the code). */
async function deployed(): Promise<boolean> {
  const res = await fetch(`${VIDEOS_API_URL}/api/openapi.json`);
  return res.ok && (await res.text()).includes(CODE);
}

test.describe.configure({ mode: 'serial' });

test.describe('pending deletion of a user\'s videos data', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One project only: one run user is enough');
    test.skip(!RUN_ID, 'Needs its own run account (E2E_RUN_ID); never a seeded user');
    // PR runs hit QA, which follows main: skip there until it has this change. Elsewhere it must be there.
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      test.skip(!(await deployed()), `${VIDEOS_API_URL} predates the pending-deletion block (#701); runs once it is on QA`);
    }
    const email = runUserEmail(runAccountName('pending-deletion'));
    const password = runPassword();
    const user = await registerSinkUser(browser, email, password);
    subject.id = user.id;
    subject.token = await getAccessToken({ role: 'nonadmin', email, password });
    const created = await asUser('POST', '/api/profiles', {
      email,
      userName: `e2e_pd_${crypto.randomUUID().slice(0, 8)}`,
      displayName: 'Pending deletion E2E',
      timezone: 'UTC',
    });
    expect(created.status, 'create the run user\'s videos profile').toBeLessThan(300);
  });

  test.afterAll(async () => {
    if (!subject.token) return;
    // Leave nothing behind: lift a deletion a failed test left, then erase the videos data as the user
    if (subject.deleted) await adminApi(`/api/content/deletions/user/${encodeURIComponent(subject.id!)}/restore`, { method: 'POST', body: '{}' });
    await asUser('DELETE', '/api/privacy/data');
  });

  test('PD-01 writes are refused with the typed code while pending; reads and sign-in keep working', async () => {
    expect((await asUser('PUT', '/api/profile', { bio: 'before' })).status, 'writes work before the delete').toBe(200);

    const deleted = await adminApi(`/api/content/users/${encodeURIComponent(subject.id!)}/delete-data`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'E2E #701' }),
    });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    subject.deleted = true;

    // Other isolates may remember "not pending" for up to 15 s
    await expect
      .poll(async () => (await asUser('PUT', '/api/profile', { bio: 'during' })).body.code, { timeout: 30_000, intervals: [1_000, 2_000, 5_000] })
      .toBe(CODE);

    const refused = await asUser('POST', '/api/channels', { name: 'Not allowed', handle: `e2e-pd-${crypto.randomUUID().slice(0, 8)}` });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe(CODE);
    expect(refused.body.error).toBe('Your videos account is scheduled for deletion. Contact support.');
    expect(Date.parse(refused.body.deletion.purgeAfter)).toBeGreaterThan(Date.now());
    for (const [method, path, body] of [
      ['POST', '/api/videos/upload/initiate', { title: 'x', fileName: 'x.mp4', fileSize: 1, contentType: 'video/mp4' }],
      ['POST', '/api/profiles', { email: 'x@e2e.alummahnow.net', userName: 'x', displayName: 'x', timezone: 'UTC' }],
      ['POST', '/api/playlists', { name: 'x' }],
    ] as const) {
      const res = await asUser(method, path, body);
      expect([res.status, res.body.code], `${method} ${path}`).toEqual([403, CODE]);
    }

    const me = await asUser('GET', '/api/profile');
    expect([me.status, me.body.code], 'the profile answers the state, not "create one"').toEqual([403, CODE]);
    const creator = await asUser('GET', '/api/me/creator');
    expect(creator.status).toBe(200);
    expect(creator.body.result).toMatchObject({ canUpload: false, canCreateChannel: false, pendingDeletion: true });
    expect((await asUser('GET', '/api/channels?limit=1')).status, 'reads still work').toBe(200);
  });

  test('PD-02 an admin restore lifts the block at once', async () => {
    test.skip(!subject.deleted, 'PD-01 did not delete the data');
    const restored = await adminApi(`/api/content/deletions/user/${encodeURIComponent(subject.id!)}/restore`, { method: 'POST', body: '{}' });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    subject.deleted = false;
    // No polling: a "pending" answer is never cached
    expect((await asUser('PUT', '/api/profile', { bio: 'after' })).status).toBe(200);
    expect((await asUser('GET', '/api/profile')).status).toBe(200);
    expect((await asUser('GET', '/api/me/creator')).body.result.pendingDeletion).toBeUndefined();
  });
});
