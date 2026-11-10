/**
 * Restore legacy profile fields, end to end on QA: seed a legacy-id (pre-SSO)
 * profile for the seeded QA viewer, see it in the dry run, Run it from the
 * admin, check the profile, the backup, the audit row and the job result, check
 * a second dry run is empty, then remove everything it added.
 *
 * Seeding writes R2 objects directly (no API writes legacy keys), so it needs
 * Cloudflare credentials: CLOUDFLARE_API_TOKEN, or locally `wrangler login`.
 * Without them the spec skips. It runs in one project only: the restore job
 * covers the whole bucket, so two copies at once would see each other's seed.
 */
import crypto from 'node:crypto';
import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';
import { accounts } from './support/env';
import { expectDirection, setPreferences } from './support/ui';
import { cfToken, DEFAULT_ACCOUNT_ID } from '../../../scripts/release/cf-api';

const PROFILES = process.env.E2E_PROFILES_BUCKET || 'profiles-qa';
const BACKUPS = process.env.E2E_ADMIN_BACKUPS_BUCKET || 'admin-backups-qa';
const LEGACY_ID = crypto.randomBytes(16).toString('hex');
const MARKER = `E2E legacy restore ${LEGACY_ID.slice(0, 8)}`;
// A language slot no seeded profile uses, so the restore has exactly one empty field to fill
const FIELD = 'bioLocalized.fr';

const token = cfToken();
const objects = (bucket: string) => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID}/r2/buckets/${bucket}/objects`;

async function r2(method: 'GET' | 'PUT' | 'DELETE', bucket: string, key: string, body?: unknown): Promise<Response> {
  return fetch(`${objects(bucket)}/${encodeURIComponent(key)}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function r2Json<T>(bucket: string, key: string): Promise<T | null> {
  const res = await r2('GET', bucket, key);
  if (res.status === 404) return null;
  expect(res.ok, `read ${bucket}/${key}`).toBe(true);
  return (await res.json()) as T;
}

interface StoredProfile { email?: string; bioLocalized?: Record<string, string>; [key: string]: unknown }
interface Plan { items: { id: string; legacyId: string; changes: { field: string; from: unknown; to: unknown }[] }[] }
interface Job { id: string; status: string; result: { written: { id: string; fields: string[]; backupKey: string }[]; skipped: unknown[] } | null }

const state: { profileId?: string; backupKeys: string[] } = { backupKeys: [] };

test.describe.configure({ mode: 'serial' });

test.describe('restore legacy profile fields', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!token, 'No Cloudflare credentials (CLOUDFLARE_API_TOKEN or wrangler login): cannot seed a legacy profile');
    test.skip(testInfo.project.name !== 'chromium', 'One project only: the job covers the whole bucket');
  });

  test.beforeAll(async () => {
    if (!token) return;
    const seeded = await r2('PUT', PROFILES, LEGACY_ID, { id: LEGACY_ID, email: accounts.nonadmin.email, bioLocalized: { fr: MARKER } });
    expect(seeded.ok, 'seed the legacy profile').toBe(true);
  });

  test.afterAll(async () => {
    if (!token) return;
    // Everything this spec added: the legacy record, the filled slot, the backups
    await r2('DELETE', PROFILES, LEGACY_ID);
    if (state.profileId) {
      const profile = await r2Json<StoredProfile>(PROFILES, state.profileId);
      if (profile?.bioLocalized?.fr === MARKER) {
        delete profile.bioLocalized.fr;
        expect((await r2('PUT', PROFILES, state.profileId, profile)).ok, 'restore the viewer profile').toBe(true);
      }
    }
    for (const key of state.backupKeys) await r2('DELETE', BACKUPS, key);
    expect(await r2Json(PROFILES, LEGACY_ID)).toBeNull();
  });

  test('LEG-01 the dry run shows the seeded record, paired on the verified email, and writes nothing', async ({ page }) => {
    const { status, body } = await adminApi('/api/content/legacy-profiles/plan');
    expect(status).toBe(200);
    const item = (body.result as Plan).items.find((i) => i.legacyId === LEGACY_ID);
    expect(item, 'the seeded legacy record is planned').toBeTruthy();
    expect(item!.changes).toEqual([{ field: FIELD, from: null, to: MARKER }]);
    state.profileId = item!.id;
    expect((await r2Json<StoredProfile>(PROFILES, item!.id))?.bioLocalized?.fr).toBeUndefined();

    await page.goto('/legacy-profiles');
    await expect(page.getByRole('heading', { level: 1, name: 'Restore legacy profile fields' })).toBeVisible();
    const row = page.locator(`[data-testid="legacy-plan"] tr[data-profile-id="${item!.id}"][data-field="${FIELD}"]`);
    await expect(row).toContainText(MARKER);
    await expect(row).toContainText('(empty)');
  });

  test('LEG-02 Run fills the field from the admin; backup, audit row and job result are there', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/legacy-profiles');
    await page.getByTestId('legacy-restore-run').click();
    await expect(page.getByText(/Each profile is backed up first/)).toBeVisible();
    await page.getByTestId('legacy-restore-confirm').click();
    await expect(page.getByTestId('legacy-restore-started')).toBeVisible();

    // The job runs from the admin-jobs queue; the page refreshes while it does
    let job: Job | undefined;
    await expect
      .poll(async () => {
        const { body } = await adminApi('/api/content/jobs?targetKind=user&targetId=legacy-profiles&limit=5');
        job = (body.result as { items: Job[] }).items.find((j) => j.result?.written.some((w) => w.id === state.profileId) || ['queued', 'running', 'retrying'].includes(j.status));
        return job?.status;
      }, { timeout: 180_000, intervals: [3_000] })
      .toBe('succeeded');
    const written = job!.result!.written.find((w) => w.id === state.profileId)!;
    expect(written.fields).toEqual([FIELD]);
    state.backupKeys.push(...job!.result!.written.map((w) => w.backupKey));

    const profile = await r2Json<StoredProfile>(PROFILES, state.profileId!);
    expect(profile?.bioLocalized?.fr).toBe(MARKER);
    // The pre-change copy, in the private backups bucket
    const backup = await r2Json<StoredProfile>(BACKUPS, written.backupKey);
    expect(backup, 'backup exists').toBeTruthy();
    expect(backup!.bioLocalized?.fr).toBeUndefined();
    expect(backup!.email).toBe(profile!.email);

    const audit = await adminApi(`/api/content/audit?kind=user&id=${encodeURIComponent(state.profileId!)}&limit=10`);
    const entry = (audit.body.result as { entries: { action: string; details: { legacyId: string } | null }[] }).entries.find((e) => e.action === 'restore-legacy-fields' && e.details?.legacyId === LEGACY_ID);
    expect(entry, 'audit row for the profile').toBeTruthy();

    await page.reload();
    const run = page.locator(`[data-testid="legacy-jobs"] tr[data-job-id="${job!.id}"]`);
    await expect(run).toHaveAttribute('data-status', 'succeeded');
    await expect(run.getByTestId('legacy-job-result')).toContainText('profiles filled');
  });

  test('LEG-03 a second dry run has nothing left to fill for it (idempotent)', async ({ page }) => {
    const { body } = await adminApi('/api/content/legacy-profiles/plan');
    expect((body.result as Plan).items.find((i) => i.legacyId === LEGACY_ID)).toBeUndefined();
    await page.goto('/legacy-profiles');
    await expect(page.locator(`[data-testid="legacy-plan"] tr[data-profile-id="${state.profileId}"][data-field="${FIELD}"]`)).toHaveCount(0);
  });

  test('LEG-04 Arabic: the page is right-to-left and translated', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto('/legacy-profiles');
    await expectDirection(page, 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'استعادة حقول الملفات الشخصية القديمة' })).toBeVisible();
  });
});
