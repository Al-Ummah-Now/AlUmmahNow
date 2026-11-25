/** Text direction in plain text (src/bidi.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isolateText, lineText, stripBidiControls } from '../src/bidi.ts';

const CONTROLS = '‪‫‬‭‮⁦⁧⁨⁩';

describe('text people typed', () => {
  it('loses its direction controls and keeps its marks', () => {
    assert.equal(stripBidiControls(`A${CONTROLS}B‎‏؜\n`), 'AB‎‏؜\n');
  });

  it('is one paragraph, isolated or for a place that isolates it', () => {
    const typed = `A${CONTROLS}\r\nB\u0085C D`;
    assert.equal(lineText(typed), 'A B C D');
    assert.equal(isolateText(typed), '⁨A B C D⁩');
    assert.equal(lineText(''), '');
  });
});
