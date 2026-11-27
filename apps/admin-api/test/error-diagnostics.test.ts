import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import { sqliteD1 } from './d1-sqlite';
import adminImportRouter from '../src/routers/adminImport.router';
import errorsRouter from '../src/routers/errors.router';
import {
  DIAGNOSTIC_MAX_BYTES,
  compressDiagnostic,
  decompressDiagnostic,
  readErrorDiagnostic,
  scrubDiagnosticContent,
  storeErrorDiagnostic,
} from '../src/lib/error-diagnostics';
import { ingestErrorEvents, listGroupEvents, pruneErrorData } from '../src/lib/errors-store';
import type { D1Database } from '../src/lib/types';

const ADMIN = 'usr_admin_diag_01';
const OTHER_ADMIN = 'usr_admin_diag_02';
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

  it('scrubs tokens, quoted JSON headers, Basic auth, query secrets, emails, home paths and UNC hostnames', () => {
    const raw = [
      'Bearer super_secret_token_abc123',
      'X-API-Key: my-secret-api-key',
      '{"x-api-key": "json-secret-999", "authorization": "Basic dXNlcjpwYXNz"}',
      'Authorization: Digest username="u", realm="r", uri="https://api.alummahnow.net/x", response="deadbeefdigest999"',
      'https://api.alummahnow.net/x?X-Amz-Signature=deadbeef&token=abc',
      'user@example.com C:\\Users\\mahmoud\\Videos\\a.mp4 /Users/mahmoud/a.mp4 \\\\Home-NAS\\Originals\\a.mp4',
    ].join('\n');
    const clean = scrubDiagnosticContent(raw);
    assert.ok(!clean.includes('super_secret_token_abc123'));
    assert.ok(!clean.includes('my-secret-api-key'));
    assert.ok(!clean.includes('json-secret-999'));
    assert.ok(!clean.includes('dXNlcjpwYXNz'));
    assert.ok(!clean.includes('deadbeefdigest999'));
    assert.ok(!clean.includes('deadbeef'));
    assert.ok(!clean.includes('user@example.com'));
    assert.ok(!clean.includes('mahmoud'));
    assert.ok(!clean.includes('Home-NAS'));
    assert.ok(clean.includes('\\\\[share]\\Originals'));
  });

  it('compresses and decompresses large (~300 KB) diagnostic payloads without stalling', async () => {
    // High-entropy lines > 64 KB compressed to exercise stream backpressure
    const lines = Array.from({ length: 3000 }, (_, i) => `2026-11-26T15:00:${String(i % 60).padStart(2, '0')}Z [WARN] retry_${i} byte=${i * 65537} hash=${(i * 2654435761 >>> 0).toString(16)}\n`).join('');
    assert.ok(lines.length > 200_000);
    const { bytes, encoding } = await compressDiagnostic(lines);
    const roundTrip = await decompressDiagnostic(bytes, encoding);
    assert.equal(roundTrip, lines);
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

  it('enforces auth, size cap, ref ownership, and fail-closed childSafety isolation', async () => {
    const bucket = fakeBucket();
    const env = { REPORTS_DB: db, DIAGNOSTICS: bucket, INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production' };
    const makeApp = (roles: string[], userId = ADMIN) => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('auth' as never, { userId, email: 'admin@example.com', roles } as never);
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
    const created = await makeApp(['Admin'], ADMIN).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ release: '2026.11.26.2', entryCount: 2, content: 'line 1\nline 2\n' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(created.status, 201);
    const createdJson = (await created.json()) as { result: { ref: string } };
    const ref = createdJson.result.ref;
    assert.match(ref, /^ERR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // Another admin cannot overwrite the first admin's bundle
    const hijack = await makeApp(['Admin'], OTHER_ADMIN).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ ref, content: 'overwritten' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(hijack.status, 409);

    // Read JSON + download text
    const jsonRes = await makeApp(['Admin']).request(`/api/errors/diagnostics/${ref}`, { method: 'GET' }, env as never);
    assert.equal(jsonRes.status, 200);
    assert.equal(((await jsonRes.json()) as { result: { content: string } }).result.content, 'line 1\nline 2\n');

    const dlRes = await makeApp(['Admin']).request(`/api/errors/diagnostics/${ref}?download=1`, { method: 'GET' }, env as never);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers.get('content-disposition'), `attachment; filename="diagnostic-${ref}.log"`);
    assert.equal(await dlRes.text(), 'line 1\nline 2\n');

    // Child-safety ref stays hidden from non-super-admins even if error_refs is later pruned
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

    // Simulate error_refs deleted while error_diagnostics still present -> still fail-closed!
    await db.prepare('DELETE FROM error_refs WHERE ref = ?').bind(csRef).run();
    const stillHidden = await makeApp(['Admin']).request(`/api/errors/diagnostics/${csRef}`, { method: 'GET' }, env as never);
    assert.equal(stillHidden.status, 404);
    const superAllowed = await makeApp(['SuperAdmin']).request(`/api/errors/diagnostics/${csRef}`, { method: 'GET' }, env as never);
    assert.equal(superAllowed.status, 200);

    // Even if a non-tools bundle was inserted after its group was deleted (child_safety=0, no error_refs), it fails closed for non-super-admins
    const orphanRef = newErrorRef();
    await storeErrorDiagnostic(db, bucket, { ref: orphanRef, app: 'admin-api', environment: 'production', content: 'raced upload', now: NOW });
    assert.equal((await makeApp(['Admin']).request(`/api/errors/diagnostics/${orphanRef}`, { method: 'GET' }, env as never)).status, 404);
    assert.equal((await makeApp(['SuperAdmin']).request(`/api/errors/diagnostics/${orphanRef}`, { method: 'GET' }, env as never)).status, 200);

    // A tools upload cannot attach to another app's ref (event-first)
    const csRef2 = newErrorRef();
    const csEv2 = scrubEvent({
      app: 'admin-api',
      kind: 'action',
      ref: csRef2,
      message: 'CSAM action 2',
      action: { key: 'child-safety-report:video:v2', source: 'other', title: 'Child safety report 2' },
    })!;
    await ingestErrorEvents(db, [csEv2], { environment: 'production', now: NOW, userKey: ADMIN });
    const crossApp = await makeApp(['Admin'], ADMIN).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ ref: csRef2, content: 'attempt' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(crossApp.status, 409);

    // Diagnostic-first order: a tools bundle uploaded before another app's event with the same ref
    // must not surface on the other app's error group
    const preRef = newErrorRef();
    const preUpload = await makeApp(['Admin'], ADMIN).request(
      '/api/admin/import/diagnostics',
      { method: 'POST', body: JSON.stringify({ ref: preRef, content: 'tools pre-upload' }), headers: { 'Content-Type': 'application/json' } },
      env as never,
    );
    assert.equal(preUpload.status, 201);
    const otherAppEv = scrubEvent({
      app: 'admin-api',
      kind: 'server',
      ref: preRef,
      message: 'Unrelated admin-api failure',
      route: '/api/health',
    })!;
    const otherIngest = await ingestErrorEvents(db, [otherAppEv], { environment: 'production', now: NOW, userKey: ADMIN });
    const otherEvents = await listGroupEvents(db, otherIngest.groups[0].groupId, 10);
    assert.equal(otherEvents[0].diagnostic_size_bytes, null);
    assert.equal(otherEvents[0].diagnostic_entry_count, null);
  });
});
