import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyContentFlags, contentFlagFields, isAgeRestricted, isMadeForKids, type ContentFlagFields } from '../src/content-flags.ts';

describe('content flags (wiki E20 §5.4, §5.5)', () => {
  it('made for kids: the video’s own choice, else what the import recorded', () => {
    assert.equal(isMadeForKids(undefined), false);
    assert.equal(isMadeForKids({ madeForKids: true }), true);
    assert.equal(isMadeForKids({ importedFrom: { madeForKids: true } }), true);
    assert.equal(isMadeForKids({ madeForKids: false, importedFrom: { madeForKids: true } }), false);
    assert.equal(isMadeForKids({ importedFrom: { madeForKids: 'yes' } }), false);
  });

  it('a creator sets and clears their own flags; false is kept for made for kids', () => {
    const v: ContentFlagFields = {};
    assert.equal(applyContentFlags(v, { ageRestricted: true }), null);
    assert.deepEqual(v, { ageRestricted: true, ageRestrictedBy: 'creator' });
    assert.equal(applyContentFlags(v, { ageRestricted: false }), null);
    assert.deepEqual(v, {});
    assert.equal(applyContentFlags(v, { madeForKids: false }), null);
    assert.deepEqual(v, { madeForKids: false });
    assert.equal(applyContentFlags(v, {}), null);
    assert.deepEqual(v, { madeForKids: false });
  });

  it('never both, in one request, across two, or against what the import recorded; nothing changes', () => {
    for (const [video, input] of [
      [{}, { ageRestricted: true, madeForKids: true }],
      [{ ageRestricted: true }, { madeForKids: true }],
      [{ madeForKids: true }, { ageRestricted: true }],
      [{ importedFrom: { madeForKids: true } }, { ageRestricted: true }],
    ] as Array<[ContentFlagFields, object]>) {
      const before = structuredClone(video);
      assert.equal(applyContentFlags(video, input), 'content_flags_conflict');
      assert.deepEqual(video, before);
    }
    const swap: ContentFlagFields = { madeForKids: true };
    assert.equal(applyContentFlags(swap, { ageRestricted: true, madeForKids: false }), null);
    assert.deepEqual(swap, { madeForKids: false, ageRestricted: true, ageRestrictedBy: 'creator' });
  });

  it('what staff set is theirs to undo; setting it again doesn’t take it over', () => {
    const v: ContentFlagFields = { ageRestricted: true, ageRestrictedBy: 'staff' };
    assert.equal(applyContentFlags(v, { ageRestricted: false }), 'age_restricted_locked');
    assert.equal(applyContentFlags(v, { ageRestricted: true }), null);
    assert.deepEqual(v, { ageRestricted: true, ageRestrictedBy: 'staff' });
  });

  it('new uploads store only what was chosen', () => {
    assert.deepEqual(contentFlagFields({}), {});
    assert.deepEqual(contentFlagFields({ madeForKids: true }), { madeForKids: true });
    assert.deepEqual(contentFlagFields({ ageRestricted: true }), { ageRestricted: true, ageRestrictedBy: 'creator' });
    assert.deepEqual(contentFlagFields({ ageRestricted: true, madeForKids: true }), {});
    assert.equal(isAgeRestricted({}), false);
  });
});
