import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import { sqliteD1 } from './helpers/sqlite-d1';
import adminImportRouter from '../src/routers/adminImport.router';
import errorsRouter from '../src/routers/errors.router';
import { DIAGNOSTIC_MAX_BYTES, scrubDiagnosticContent, storeErrorDiagnostic, readErrorDiagnostic } from '../src/lib/error-diagnostics';
import { ingestErrorEvents, listGroupEvents, pruneErrorData } from '../src/lib/errors-store';
import type { D1Database } from '../src/lib/types';

const ADMIN = 'usr_admin_diag_01';
const NOW = new Date('2026-11-26T15:00:00Z');

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  return {
    store,
    async put(key: string, value: Uint8Array | ArrayBuffer | string, opts?: { customMetadata?: Record<string, string> }) {
      const bytes =
        value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new TextEncoder().encode(value);
      store.set(key, { bytes, meta: opts?.customMetadata });
    },
    async get(key: string) {
      const hit = store.get(key);
      if (!hit) return null;
      return { async arrayBuffer() { return hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength); } };
    },
  };
}

describe('error diagnostics (R2 bundles)', () => {
  let db: D1Database;
  beforeEach(() => {
    db = sqliteD1();
  });

  it('scrubs tokens, headers, query secrets, emails, home paths and UNC hostnames', () => {
    const raw = [
      'Bearer super_secret_token_abc123',
      'X-API-Key: my-secret-api-key',
      'https://api.alummahnow.net/x?X-Amz-Signature=deadbeef&token=abc',
      'user@example.com C:\\Users\\mahmoud\\Videos\\a.mp4 /Users/mahmoud/a.mp4 \\\\Home-NAS\\Originals\\a.mp4',
    ].join('\n');
    const clean = scrubDiagnosticContent(raw);
    assert.ok(!clean.includes('super_secret_token_abc123'));
    assert.ok(!clean.includes('my-secret-api-key'));
    assert.ok(!clean.includes('deadbeef'));
    assert.ok(!clean.includes('user@example.com'));
    assert.ok(!clean.includes('mahmoud'));
    assert.ok(!clean.includes('Home-NAS'));
    assert.ok(clean.includes('\\\\[share]\\Originals'));
  });

  it('stores gzipped bundle in R2, joins diagnostic metadata onto listGroupEvents, and prunes after 30 days', async () => {
    const bucket = fakeBucket();
    const ref = newErrorRef();
    const ev = scrubEvent({ app: 'tools', kind: 'upload', ref, message: 'Windows error 59 at byte 1024', route: '/import/upload' })!;
    const ingest = await ingestErrorEvents(db, [ev], { environment: 'production', now: NOW, userKey: ADMIN });
    const stored = await storeErrorDiagnostic(db, bucket, {
      ref,
      app: 'tools',
      environment: 'production',
      release: '2026.11.26.2',
      userId: ADMIN,
      entryCount: 3,
      content: '2026-11-26T15:00:00Z [ERROR] read_error Windows error 59 for user@example.com\n',
      now: NOW,
    });
    assert.equal(stored.ref, ref);
    assert.equal(bucket.store.size, 1);

    const events = await listGroupEvents(db, ingest.groups[0].groupId, 10);
    assert.equal(events[0].diagnostic_size_bytes, stored.sizeBytes);
    assert.equal(events[0].diagnostic_entry_count, 3);

    const read = await readErrorDiagnostic(db, bucket, ref);
    assert.ok(read);
    assert.ok(read.content.includes('Windows error 59 for [email]'));

    await pruneErrorData(db, new Date(NOW.getTime() + 31 * 86_400_000));
    assert.equal(await readErrorDiagnostic(db, bucket, ref), null);
  });

  it('POST /api/admin/import/diagnostics and GET /api/errors/diagnostics/:ref enforce auth, size cap, and childSafety', async () => {
    const bucket = fakeBucket();
    const env = { REPORTS_DB: db, DIAGNOSTICS: bucket, INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production' };
    const makeApp = (roles: string[]) => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('auth' as never, { userId: ADMIN, email: 'admin@example.com', roles } as never);
        await next();
      });
      app.route('/api/admin/import', adminImportRouter);
      app.route('/api/errors', errorsRouter);
      return app;
    };

    // Non-staff refused
    const forbidden = await makeApp(['Moderator']).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ content: 'hello' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(forbidden.status, 403);

    // Oversized refused
    const tooBig = await makeApp(['Admin']).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ content: 'a'.repeat(DIAGNOSTIC_MAX_BYTES + 100) }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(tooBig.status, 413);

    // Upload with auto-generated ref
    const created = await makeApp(['Admin']).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ release: '2026.11.26.2', entryCount: 2, content: 'line 1\nline 2\n' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(created.status, 201);
    const createdJson = (await created.json()) as { result: { ref: string } };
    const ref = createdJson.result.ref;
    assert.match(ref, /^ERR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // Read JSON + download text
    const jsonRes = await makeApp(['Admin']).request(`/api/errors/diagnostics/${ref}`, { method: 'GET' }, env as never);
    assert.equal(jsonRes.status, 200);
    assert.equal(((await jsonRes.json()) as { result: { content: string } }).result.content, 'line 1\nline 2\n');

    const dlRes = await makeApp(['Admin']).request(`/api/errors/diagnostics/${ref}?download=1`, { method: 'GET' }, env as never);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers.get('content-disposition'), `attachment; filename="diagnostic-${ref}.log"`);
    assert.equal(await dlRes.text(), 'line 1\nline 2\n');

    // Child-safety ref hidden from non-super-admins
    const csRef = newErrorRef();
    const csEv = scrubEvent({
      app: 'admin-api',
      kind: 'action',
      ref: csRef,
      message: 'CSAM action',
      action: { key: 'child-safety-report:video:v1', source: 'other', title: 'Child safety report' },
    })!;
    await ingestErrorEvents(db, [csEv], { environment: 'production', now: NOW, userKey: ADMIN });
    await storeErrorDiagnostic(db, bucket, { ref: csRef, app: 'admin-api', environment: 'production', content: 'sensitive', now: NOW });

    const adminHidden = await makeApp(['Admin']).request(`/api/errors/diagnostics/${csRef}`, { method: 'GET' }, env as never);
    assert.equal(adminHidden.status, 404);
    const superAllowed = await makeApp(['SuperAdmin']).request(`/api/errors/diagnostics/${csRef}`, { method: 'GET' }, env as never);
    assert.equal(superAllowed.status, 200);
  });
});
