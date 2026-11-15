/** Container routes answer with a reason, never a stack trace (CodeQL alert #123). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorReason } from '../container/errors.mjs';

describe('container error reasons', () => {
	it('answers with the message only, never the stack', () => {
		const error = new Error('ffmpeg exited 1');
		assert.equal(errorReason(error), 'ffmpeg exited 1');
		assert.doesNotMatch(errorReason(error), /at |server\.mjs|\n/);
	});

	it('keeps the first line of a multi-line message and caps the length', () => {
		assert.equal(errorReason(new Error('bad input\n    at run (/app/server.mjs:12:3)')), 'bad input');
		assert.equal(errorReason(new Error('x'.repeat(500))).length, 300);
		assert.equal(errorReason(new Error('x'.repeat(50)), 10), 'x'.repeat(10));
	});

	it('never stringifies a non-Error value that could carry a stack', () => {
		assert.equal(errorReason('plain reason'), 'plain reason');
		assert.equal(errorReason({ stack: 'Error\n    at secret (/app/x.mjs:1:1)', toString: () => 'leak' }), 'unknown error');
		assert.equal(errorReason(undefined), 'unknown error');
		assert.equal(errorReason(new Error('')), 'unknown error');
	});

	it('every 500 answer of the job server goes through errorReason', () => {
		const server = readFileSync(join(process.cwd(), 'container', 'server.mjs'), 'utf8') // run from apps/media (CommonJS: no import.meta);
		const answers = server.split('\n').filter((l) => /send\(5\d\d,/.test(l));
		assert.ok(answers.length >= 3, 'the remux, review and audio routes answer 500 on failure');
		for (const line of answers) {
			assert.doesNotMatch(line, /error\?\.message|String\(error/, line.trim());
			assert.match(line, /errorReason\(error\)/, line.trim());
		}
	});
});
