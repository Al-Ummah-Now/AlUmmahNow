import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_SUGGESTION_TYPES,
	MATCH_SCORE,
	findMatchRanges,
	normalizeSearchText,
	parseSuggestionTypes,
	rankSuggestions,
	scoreSuggestionMatch,
	splitHighlight,
} from '@al-ummah/shared-types';

const marked = (text: string, query: string) =>
	splitHighlight(text, query).filter(p => p.match).map(p => p.text);

describe('suggestion normalisation', () => {
	it('folds the Arabic spelling variants a reader treats as the same word', () => {
		assert.equal(normalizeSearchText('أَحْمَد'), normalizeSearchText('احمد'));
		assert.equal(normalizeSearchText('إسلام'), normalizeSearchText('اسلام'));
		assert.equal(normalizeSearchText('آمنة'), normalizeSearchText('امنه'));
		assert.equal(normalizeSearchText('مصطفى'), normalizeSearchText('مصطفي'));
		assert.equal(normalizeSearchText('الصَّلاة'), normalizeSearchText('الصلاه'));
		assert.equal(normalizeSearchText('École'), 'ecole');
	});
});

describe('scoreSuggestionMatch', () => {
	it('orders exact > prefix > word prefix > all words > substring > none', () => {
		assert.equal(scoreSuggestionMatch('Fiqh', 'fiqh'), MATCH_SCORE.exact);
		assert.equal(scoreSuggestionMatch('Fiqh of fasting', 'fiq'), MATCH_SCORE.prefix);
		assert.equal(scoreSuggestionMatch('Rules of fasting', 'fast'), MATCH_SCORE.wordPrefix);
		assert.equal(scoreSuggestionMatch('Rules of fasting', 'of fas'), MATCH_SCORE.wordPrefix);
		assert.equal(scoreSuggestionMatch('Rules of fasting', 'fast rul'), MATCH_SCORE.allWordsPrefix);
		assert.equal(scoreSuggestionMatch('Breakfast', 'fast'), MATCH_SCORE.substring);
		assert.equal(scoreSuggestionMatch('Seerah', 'tafsir'), MATCH_SCORE.none);
		assert.equal(scoreSuggestionMatch('', 'x'), MATCH_SCORE.none);
		assert.equal(scoreSuggestionMatch('x', '  '), MATCH_SCORE.none);
	});

	it('matches Arabic words with or without the article and with any spelling variant', () => {
		assert.equal(scoreSuggestionMatch('أحكام الصَّلاة', 'احكام'), MATCH_SCORE.prefix);
		assert.equal(scoreSuggestionMatch('أحكام الصَّلاة', 'صلاه'), MATCH_SCORE.wordPrefix);
		assert.equal(scoreSuggestionMatch('أحكام الصَّلاة', 'الصلاة'), MATCH_SCORE.wordPrefix);
		assert.equal(scoreSuggestionMatch('قناة الحديث', 'حديث'), MATCH_SCORE.wordPrefix);
	});
});

describe('rankSuggestions', () => {
	const items = ['Breakfast with family', 'Rules of fasting', 'Fasting in Ramadan', 'Fast', 'Seerah'];

	it('drops non-matches and orders by match quality, then shorter text, then input order', () => {
		assert.deepEqual(rankSuggestions(items, 'fast', s => s), ['Fast', 'Fasting in Ramadan', 'Rules of fasting', 'Breakfast with family']);
	});

	it('keeps the input order for a blank query and respects the limit', () => {
		assert.deepEqual(rankSuggestions(items, '', s => s, { limit: 2 }), items.slice(0, 2));
		assert.deepEqual(rankSuggestions(items, 'fast', s => s, { limit: 1 }), ['Fast']);
	});

	it('uses alternates (handles, other languages) and weight for ties', () => {
		const channels = [
			{ name: 'قناة الحديث', en: 'Hadith Channel', subs: 3 },
			{ name: 'Hadith Daily', en: undefined, subs: 10 },
		];
		const ranked = rankSuggestions(channels, 'hadith', c => c.name, { alternates: c => [c.en], weight: c => c.subs });
		assert.deepEqual(ranked.map(c => c.name), ['Hadith Daily', 'قناة الحديث']);
	});

	it('can keep unmatched items after the matches', () => {
		assert.deepEqual(rankSuggestions(['b', 'a', 'ab'], 'a', s => s, { keepUnmatched: true }), ['a', 'ab', 'b']);
	});
});

describe('findMatchRanges / splitHighlight', () => {
	it('highlights the original characters, including the marks on matched letters', () => {
		assert.deepEqual(marked('أَحْمَد يوسف', 'احمد'), ['أَحْمَد']);
		assert.deepEqual(marked('École normale', 'ecole'), ['École']);
		assert.deepEqual(marked('مصطفى محمود', 'مصطفي'), ['مصطفى']);
	});

	it('prefers word starts, then the word after an Arabic article, then any substring', () => {
		assert.deepEqual(marked('Breakfast and fasting', 'fast'), ['fast'], 'only the word start');
		assert.deepEqual(splitHighlight('Breakfast and fasting', 'fast').map(p => p.text), ['Breakfast and ', 'fast', 'ing']);
		assert.deepEqual(marked('شرح الحديث', 'حديث'), ['حديث']);
		assert.deepEqual(marked('Breakfast', 'fast'), ['fast']);
	});

	it('marks every query word and merges overlapping ranges', () => {
		assert.deepEqual(marked('Seerah part 2: Madinah', 'seerah mad'), ['Seerah', 'Mad']);
		assert.deepEqual(findMatchRanges('abc', 'ab abc'), [{ start: 0, end: 3 }]);
	});

	it('returns the whole text unmarked when nothing matches or the query is blank', () => {
		assert.deepEqual(splitHighlight('Seerah', 'tafsir'), [{ text: 'Seerah', match: false }]);
		assert.deepEqual(splitHighlight('Seerah', ''), [{ text: 'Seerah', match: false }]);
		assert.deepEqual(splitHighlight('', 'x'), []);
	});

	it('keeps hamza-dropping and tatweel aligned with the original text', () => {
		assert.deepEqual(marked('سماء صافية', 'صافيه'), ['صافية']);
		assert.deepEqual(marked('محمـــد علي', 'علي'), ['علي']);
	});
});

describe('parseSuggestionTypes', () => {
	it('keeps known types in order, without duplicates, defaulting when empty', () => {
		assert.deepEqual(parseSuggestionTypes('playlist, video,bogus,video'), ['playlist', 'video']);
		assert.deepEqual(parseSuggestionTypes(''), DEFAULT_SUGGESTION_TYPES);
		assert.deepEqual(parseSuggestionTypes('bogus'), DEFAULT_SUGGESTION_TYPES);
		assert.deepEqual(parseSuggestionTypes(undefined), DEFAULT_SUGGESTION_TYPES);
	});
});
