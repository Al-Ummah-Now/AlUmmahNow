/**
 * Bulk edit of a creator's videos (Epic 5.3), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-library.ts.
 */

export interface BulkEditTranslations {
  button: string;
  title: string;
  description: string;
  visibility: string;
  category: string;
  noChange: string;
  public: string;
  private: string;
  clearCategory: string;
  addTags: string;
  removeTags: string;
  tagsHint: string;
  apply: string;
  applying: string;
  cancel: string;
  nothingToApply: string;
  done: string;
  partial: string;
  failed: string;
}

export const BULK_EDIT_EN: BulkEditTranslations = {
  button: 'Edit',
  title: 'Edit {count} videos',
  description: 'Only the fields you change are updated. Scheduled videos keep the visibility set by their schedule.',
  visibility: 'Visibility',
  category: 'Category',
  noChange: 'No change',
  public: 'Public',
  private: 'Private',
  clearCategory: 'Remove category',
  addTags: 'Add tags',
  removeTags: 'Remove tags',
  tagsHint: 'Separate tags with commas',
  apply: 'Apply changes',
  applying: 'Applying…',
  cancel: 'Cancel',
  nothingToApply: 'Choose at least one change.',
  done: '{count} videos updated',
  partial: '{succeeded} videos updated; {failed} could not be changed',
  failed: 'The videos could not be updated. Please try again.',
};

export const BULK_EDIT_AR: BulkEditTranslations = {
  button: 'تعديل',
  title: 'تعديل {count} من المقاطع',
  description: 'تُحدَّث الحقول التي تغيّرها فقط. تحتفظ المقاطع المجدولة بالظهور الذي يحدده جدولها.',
  visibility: 'الظهور',
  category: 'التصنيف',
  noChange: 'بدون تغيير',
  public: 'عام',
  private: 'خاص',
  clearCategory: 'إزالة التصنيف',
  addTags: 'إضافة وسوم',
  removeTags: 'إزالة وسوم',
  tagsHint: 'افصل بين الوسوم بفواصل',
  apply: 'تطبيق التغييرات',
  applying: 'جارٍ التطبيق…',
  cancel: 'إلغاء',
  nothingToApply: 'اختر تغييرًا واحدًا على الأقل.',
  done: 'تم تحديث {count} من المقاطع',
  partial: 'تم تحديث {succeeded} من المقاطع، وتعذّر تغيير {failed}',
  failed: 'تعذّر تحديث المقاطع. حاول مرة أخرى.',
};
