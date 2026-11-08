import { applyChangesLocally, buildBulkChanges, CLEAR_CATEGORY, EMPTY_BULK_EDIT, parseTags } from '../bulk-edit';

describe('bulk edit helpers (Epic 5.3)', () => {
  it('parses Latin and Arabic comma separated tags, trimmed and deduplicated', () => {
    expect(parseTags(' Tafsir, Seerah، رمضان ,tafsir,, ')).toEqual(['Tafsir', 'Seerah', 'رمضان']);
    expect(parseTags('')).toEqual([]);
  });

  it('returns null when the form changes nothing', () => {
    expect(buildBulkChanges(EMPTY_BULK_EDIT)).toBeNull();
    expect(buildBulkChanges({ ...EMPTY_BULK_EDIT, addTags: ' , ، ' })).toBeNull();
  });

  it('maps every field to the API shape', () => {
    expect(buildBulkChanges({ visibility: 'private', category: CLEAR_CATEGORY, addTags: 'a', removeTags: 'b, c' })).toEqual({
      isPublic: false,
      category: null,
      addTags: ['a'],
      removeTags: ['b', 'c'],
    });
    expect(buildBulkChanges({ ...EMPTY_BULK_EDIT, visibility: 'public', category: 'education' })).toEqual({ isPublic: true, category: 'education' });
  });

  it('applies changes to the local copy without duplicating tags', () => {
    const video = { id: 'v1', isPublic: false, category: 'education', tags: ['Fiqh', 'old'] };
    expect(applyChangesLocally(video, { isPublic: true, category: null, addTags: ['fiqh', 'new'], removeTags: ['OLD'] })).toEqual({
      id: 'v1',
      isPublic: true,
      category: undefined,
      tags: ['Fiqh', 'new'],
    });
    expect(video.tags).toEqual(['Fiqh', 'old']);
  });
});
