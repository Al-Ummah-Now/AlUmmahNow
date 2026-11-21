import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { keepTimeTogether } from '../src/i18n/time-together';

describe('keepTimeTogether', () => {
  it('joins the time, AM/PM and zone with no-break spaces and leaves the break after the date', () => {
    assert.equal(keepTimeTogether('Nov 21, 2026, 4:05 PM EST'), 'Nov 21, 2026, 4:05 PM EST');
    assert.equal(keepTimeTogether('Nov 21, 2026, 3:20 PM UTC'), 'Nov 21, 2026, 3:20 PM UTC');
  });
  it('does the same after the Arabic comma', () => {
    assert.equal(keepTimeTogether('٢١ نوفمبر ٢٠٢٦، ٩:٠٧ ص غرينتش-٥'), '٢١ نوفمبر ٢٠٢٦، ٩:٠٧ ص غرينتش-٥');
  });
  it('joins the whole string when there is no comma', () => {
    assert.equal(keepTimeTogether('9:07 AM EST'), '9:07 AM EST');
  });
});
