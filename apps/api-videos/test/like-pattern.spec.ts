import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D1_LIKE_PATTERN_MAX_BYTES, containsPattern } from '@al-ummah/shared-types';
import { likeTerm } from '../src/lib/admin/directory';
import { SqliteD1 } from './search-sqlite-d1';

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('LIKE patterns stay within D1\'s 50-byte limit ("LIKE or GLOB pattern too complex")', () => {
	it('keeps a short term whole, with the wildcards escaped', () => {
		assert.equal(containsPattern('a_b%c\\d'), '%a\\_b\\%c\\\\d%');
		assert.equal(likeTerm('  Tafsir '), '%tafsir%');
	});

	it('cuts a long term to its start, never past the limit', () => {
		const email = 'e2e+43277005165-1-admin-chromium-invite-48cdd6@e2e.alummahnow.net';
		const pattern = containsPattern(email);
		assert.ok(bytes(pattern) <= D1_LIKE_PATTERN_MAX_BYTES, `${bytes(pattern)} bytes`);
		assert.equal(pattern, `%${email.slice(0, D1_LIKE_PATTERN_MAX_BYTES - 2)}%`);
	});

	it('never splits an escape pair or a multi-byte character', () => {
		const underscores = containsPattern('_'.repeat(40));
		assert.ok(bytes(underscores) <= D1_LIKE_PATTERN_MAX_BYTES);
		assert.match(underscores, /^%(\\_)+%$/);
		const arabic = containsPattern('تفسير سورة البقرة للشيخ الفاضل محمد');
		assert.ok(bytes(arabic) <= D1_LIKE_PATTERN_MAX_BYTES);
		assert.ok(!arabic.includes('�'));
	});

	it('a long term still finds its row in SQLite', () => {
		const db = new SqliteD1();
		db.db.exec(`CREATE TABLE t (email TEXT); INSERT INTO t VALUES ('e2e+43277005165-1-admin-chromium-invite-48cdd6@e2e.alummahnow.net'), ('someone@example.com')`);
		const rows = db.db.prepare(`SELECT email FROM t WHERE email LIKE ? ESCAPE '\\'`).all(likeTerm('E2E+43277005165-1-admin-chromium-invite-48cdd6@e2e.alummahnow.net')) as { email: string }[];
		assert.deepEqual(rows.map((r) => r.email), ['e2e+43277005165-1-admin-chromium-invite-48cdd6@e2e.alummahnow.net']);
	});
});
