import { retryMetadata } from '../retry';

describe('retryMetadata', () => {
  it('carries over the details of the failed upload', () => {
    expect(retryMetadata({ title: 'T', titleLocalized: { en: 'En', ar: 'Ar' }, description: 'D', descriptionLocalized: { ar: 'DA' }, tags: ['a'], category: 'tafsir', isPublic: false }))
      .toEqual({ title: 'T', titleEn: 'En', titleAr: 'Ar', description: 'D', descriptionEn: 'D', descriptionAr: 'DA', tags: ['a'], category: 'tafsir', isPublic: false });
  });

  it('falls back when fields are missing', () => {
    expect(retryMetadata({})).toEqual({ title: '', titleEn: '', titleAr: '', description: '', descriptionEn: '', descriptionAr: '', tags: [], isPublic: true });
  });
});
