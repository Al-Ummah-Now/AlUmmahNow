/** Live admin events go to every admin: they never name what only super admins may see (docs/admin/LIVE_OPS.md). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jobLiveEvent } from '../src/lib/admin/jobs';

describe('admin:jobs events', () => {
	it('say which job and how it is doing, not what it is about', () => {
		const e = jobLiveEvent({ id: 'job-1', kind: 'csam.contain', targetKind: 'video', targetId: '00000000-0000-4000-8000-000000000001' }, 'running', 2);
		assert.deepEqual(e, { kind: 'job', key: 'job:job-1', id: 'job-1', jobKind: 'csam.contain', status: 'running', attempts: 2 });
		assert.doesNotMatch(JSON.stringify(e), /00000000-0000-4000-8000-000000000001/);
	});
});
