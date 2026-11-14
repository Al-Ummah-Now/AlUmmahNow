import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cell, envOf, isAlUmmah } from '../usage-report.ts';

test('only al-ummah resources are attributed (the account is shared)', () => {
	for (const n of ['al-ummah-web-qa', 'al-ummah-now-d1', 'videos', 'videos-qa', 'global-settings-qa', 'audit-events-stage-dlq', 'moderation-actions-qa-dlq', 'channels-pr-12', 'watch-history-preview']) {
		assert.equal(isAlUmmah(n), true, n);
	}
	for (const n of ['videosx', 'my-videos', 'other-project-db', 'channels-prod-copy', 'reports2']) assert.equal(isAlUmmah(n), false, n);
});

test('env from the name', () => {
	assert.equal(envOf('al-ummah-web-qa'), 'qa');
	assert.equal(envOf('al-ummah-now-auth-stage'), 'stage');
	assert.equal(envOf('videos-staging'), 'stage');
	assert.equal(envOf('al-ummah-api-pr-1266'), 'preview');
	assert.equal(envOf('al-ummah-now-www-preview-street'), 'preview');
	assert.equal(envOf('al-ummah-admin-web-dev'), 'dev');
	assert.equal(envOf('al-ummah-now-production'), 'production');
	assert.equal(envOf('videos'), 'production');
});

test('table cells escape backslashes before pipes', () => {
	assert.equal(cell('a|b'), 'a\\|b');
	assert.equal(cell('a\\|b'), 'a\\\\\\|b');
	assert.equal(cell('x\ny'), 'x y');
});
