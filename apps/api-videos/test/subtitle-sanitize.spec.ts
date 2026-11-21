/**
 * Subtitle cue text is stripped of markup before it is stored (CodeQL
 * js/bad-tag-filter, js/incomplete-multi-character-sanitization).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText } from '../src/lib/subtitles/parser';

describe('subtitle sanitizeText', () => {
  it('keeps plain English and Arabic cue text', () => {
    assert.equal(sanitizeText('  In the name of   Allah '), 'In the name of Allah');
    assert.equal(sanitizeText('بسم الله الرحمن الرحيم'), 'بسم الله الرحمن الرحيم');
  });

  it('drops formatting tags but keeps their text', () => {
    assert.equal(sanitizeText('<i>Peace</i> be <b>upon</b> you'), 'Peace be upon you');
  });

  it('drops script bodies, including end tags with spaces or junk before >', () => {
    assert.equal(sanitizeText('a<script>steal()</script>b'), 'ab');
    assert.equal(sanitizeText('a<script>steal()</script >b'), 'ab');
    assert.equal(sanitizeText('a<SCRIPT type="x">steal()</script\tfoo>b'), 'ab');
    assert.equal(sanitizeText('a<script>\nsteal()\n</script>b'), 'ab');
  });

  it('never leaves a tag or angle bracket behind, even from nested pieces', () => {
    for (const input of ['<scr<script>x</script>ipt>alert(1)</script>', '<<b>script>alert(1)<</b>/script>', '<img src=x onerror=alert(1)', 'x < y > z']) {
      const out = sanitizeText(input);
      assert.doesNotMatch(out, /[<>]/, input);
    }
  });
});
