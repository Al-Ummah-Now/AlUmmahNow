/** Studio Comments: a post without a title is named by an excerpt of its text that ends on a whole word. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postTitle } from '../src/lib/channelComments/hydrate';

describe('postTitle (Studio Comments target column)', () => {
	it('keeps a title, and short text as it is', () => {
		assert.equal(postTitle({ title: ' Weekly notes ', content: 'x' }), 'Weekly notes');
		assert.equal(postTitle({ content: '<p>Short post</p>' }), 'Short post');
	});

	it('cuts long text after a whole word, without trailing punctuation', () => {
		const text = 'Assalamu alaikum everyone. This week we answer your questions about the new series and the upload schedule.';
		const title = postTitle({ content: text });
		assert.equal(title, 'Assalamu alaikum everyone. This week we answer your questions about the new…');
		assert.ok(title.length <= 81);
		const ar = 'السلام عليكم جميعًا. نجيب هذا الأسبوع عن أسئلتكم حول السلسلة الجديدة وموعد رفع المرئيات، وعن مواعيد البث.';
		const excerpt = postTitle({ content: ar }).slice(0, -1);
		assert.ok(ar.startsWith(excerpt), 'a prefix of the text');
		assert.equal(ar[excerpt.length], ' ', 'ends where a word ends');
	});

	it('cuts a single very long word at the limit', () => {
		assert.equal(postTitle({ content: 'a'.repeat(120) }), `${'a'.repeat(79)}…`);
	});
});
