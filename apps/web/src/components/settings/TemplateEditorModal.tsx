'use client';

/**
 * TemplateEditorModal Component
 *
 * Modal for creating and editing upload templates.
 * Supports bilingual fields (EN/AR) and template variables.
 */

import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  UploadTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  VideoCategory,
  VIDEO_CATEGORIES,
} from '@al-ummah/shared-types';
import { VariableGuide } from './VariableGuide';
import { createTemplate, updateTemplate } from '@/lib/api/upload-defaults';

interface TemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  template?: UploadTemplate;
  mode: 'create' | 'edit';
}

export function TemplateEditorModal({
  isOpen,
  onClose,
  onSuccess,
  template,
  mode,
}: TemplateEditorModalProps) {
  const { t, isRTL, lang } = useLanguage();

  // Form state
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState<VideoCategory | ''>('');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'unlisted'>('public');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [isDefault, setIsDefault] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);

  // Load template data when editing
  useEffect(() => {
    if (mode === 'edit' && template) {
      setNameEn(template.nameLocalized?.en || template.name);
      setNameAr(template.nameLocalized?.ar || '');
      setDescription(template.description || '');
      setTitleEn(template.template.titleLocalized?.en || template.template.title || '');
      setTitleAr(template.template.titleLocalized?.ar || '');
      setDescriptionEn(template.template.descriptionLocalized?.en || template.template.description || '');
      setDescriptionAr(template.template.descriptionLocalized?.ar || '');
      setTags(template.template.tags?.join(', ') || '');
      setCategory(template.template.category || '');
      setVisibility(template.template.visibility || 'public');
      // Only set language if it's 'en' or 'ar' (filter out other locales)
      const validLanguage = template.template.language === 'ar' ? 'ar' : 'en';
      setLanguage(validLanguage);
      setIsDefault(template.isDefault);
    }
  }, [mode, template]);

  // Escape closes the dialog wherever focus is (Safari does not focus clicked
  // buttons, so a keydown handler on the overlay alone missed it)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setNameEn('');
      setNameAr('');
      setDescription('');
      setTitleEn('');
      setTitleAr('');
      setDescriptionEn('');
      setDescriptionAr('');
      setTags('');
      setCategory('');
      setVisibility('public');
      setLanguage('en');
      setIsDefault(false);
      setError(null);
      setActiveField(null);
    }
  }, [isOpen]);

  // Handle variable insertion
  const handleInsertVariable = (variable: string) => {
    if (!activeField) return;

    const setters: Record<string, React.Dispatch<React.SetStateAction<string>>> = {
      titleEn: setTitleEn,
      titleAr: setTitleAr,
      descriptionEn: setDescriptionEn,
      descriptionAr: setDescriptionAr,
    };

    const setter = setters[activeField];
    if (setter) {
      setter((prev) => prev + variable);
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      // Validation
      if (!nameEn.trim()) {
        setError(isRTL ? 'اسم القالب مطلوب' : 'Template name is required');
        setSaving(false);
        return;
      }

      if (!titleEn.trim()) {
        setError(isRTL ? 'العنوان مطلوب' : 'Title is required');
        setSaving(false);
        return;
      }

      // Parse tags
      const tagArray = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      // Build request
      const templateData: CreateTemplateRequest | UpdateTemplateRequest = {
        name: nameEn,
        nameLocalized: nameAr ? { en: nameEn, ar: nameAr } : undefined,
        description: description || undefined,
        isDefault,
        template: {
          title: titleEn,
          titleLocalized: titleAr ? { en: titleEn, ar: titleAr } : undefined,
          description: descriptionEn || undefined,
          descriptionLocalized: descriptionAr ? { en: descriptionEn, ar: descriptionAr } : undefined,
          tags: tagArray.length > 0 ? tagArray : undefined,
          category: category || undefined,
          visibility,
          language,
        },
      };

      // Save template
      let result;
      if (mode === 'create') {
        result = await createTemplate(templateData as CreateTemplateRequest);
      } else if (template) {
        result = await updateTemplate(template.id, templateData as UpdateTemplateRequest);
      }

      if (result) {
        onSuccess();
        onClose();
      } else {
        setError(isRTL ? 'فشل في حفظ القالب' : 'Failed to save template');
      }
    } catch (_err) {
      setError(isRTL ? 'حدث خطأ أثناء الحفظ' : 'An error occurred while saving');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-editor-title"
        data-testid="template-editor"
        className="
          relative
          w-full
          max-w-4xl
          max-h-[90vh]
          bg-white
          dark:bg-gray-900
          rounded-lg
          shadow-xl
          overflow-hidden
          flex
          flex-col
        "
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 id="template-editor-title" className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'create'
              ? isRTL
                ? 'إنشاء قالب جديد'
                : 'Create New Template'
              : isRTL
              ? 'تعديل القالب'
              : 'Edit Template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            data-testid="template-editor-close"
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Error Message */}
            {error && (
              <div role="alert" data-testid="template-editor-error" className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Template Name */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {isRTL ? 'معلومات القالب' : 'Template Information'}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="template-name-en" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'اسم القالب (إنجليزي)' : 'Template Name (English)'}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="template-name-en"
                    data-testid="template-name-en"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder={isRTL ? 'مثال: قالب المحاضرات' : 'e.g., Lecture Template'}
                  />
                </div>

                <div>
                  <label htmlFor="template-name-ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'اسم القالب (عربي)' : 'Template Name (Arabic)'}
                  </label>
                  <input
                    type="text"
                    id="template-name-ar"
                    data-testid="template-name-ar"
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder="مثال: قالب المحاضرات"
                    dir="rtl"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="template-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {isRTL ? 'وصف القالب' : 'Template Description'}
                </label>
                <textarea
                  id="template-description"
                  data-testid="template-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="
                    w-full
                    px-4
                    py-2
                    border
                    border-gray-300
                    dark:border-gray-600
                    rounded-lg
                    bg-white
                    dark:bg-gray-800
                    text-gray-900
                    dark:text-gray-100
                    focus:ring-2
                    focus:ring-primary
                    focus:border-transparent
                  "
                  placeholder={isRTL ? 'وصف اختياري لهذا القالب' : 'Optional description for this template'}
                />
              </div>

              {/* Set as Default */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isDefault"
                  data-testid="template-is-default"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 text-primary border-gray-300 dark:border-gray-600 rounded focus:ring-primary"
                />
                <label htmlFor="isDefault" className="ms-2 text-sm text-gray-700 dark:text-gray-300">
                  {isRTL ? 'تعيين كقالب افتراضي' : 'Set as default template'}
                </label>
              </div>
            </div>

            {/* Variable Guide */}
            <VariableGuide onInsertVariable={handleInsertVariable} />

            {/* Video Metadata */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {isRTL ? 'بيانات الفيديو' : 'Video Metadata'}
              </h3>

              {/* Title */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="template-title-en" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'العنوان (إنجليزي)' : 'Title (English)'}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="template-title-en"
                    data-testid="template-title-en"
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                    onFocus={() => setActiveField('titleEn')}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder={isRTL ? 'استخدم المتغيرات مثل {{date}}' : 'Use variables like {{date}}'}
                  />
                </div>

                <div>
                  <label htmlFor="template-title-ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'العنوان (عربي)' : 'Title (Arabic)'}
                  </label>
                  <input
                    type="text"
                    id="template-title-ar"
                    data-testid="template-title-ar"
                    value={titleAr}
                    onChange={(e) => setTitleAr(e.target.value)}
                    onFocus={() => setActiveField('titleAr')}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder="استخدم المتغيرات مثل {{date}}"
                    dir="rtl"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="template-description-en" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'الوصف (إنجليزي)' : 'Description (English)'}
                  </label>
                  <textarea
                    id="template-description-en"
                    data-testid="template-description-en"
                    value={descriptionEn}
                    onChange={(e) => setDescriptionEn(e.target.value)}
                    onFocus={() => setActiveField('descriptionEn')}
                    rows={4}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder={isRTL ? 'استخدم المتغيرات مثل {{channel_name}}' : 'Use variables like {{channel_name}}'}
                  />
                </div>

                <div>
                  <label htmlFor="template-description-ar" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'الوصف (عربي)' : 'Description (Arabic)'}
                  </label>
                  <textarea
                    id="template-description-ar"
                    data-testid="template-description-ar"
                    value={descriptionAr}
                    onChange={(e) => setDescriptionAr(e.target.value)}
                    onFocus={() => setActiveField('descriptionAr')}
                    rows={4}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                    placeholder="استخدم المتغيرات مثل {{channel_name}}"
                    dir="rtl"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label htmlFor="template-tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {isRTL ? 'الوسوم' : 'Tags'}
                </label>
                <input
                  type="text"
                  id="template-tags"
                  data-testid="template-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="
                    w-full
                    px-4
                    py-2
                    border
                    border-gray-300
                    dark:border-gray-600
                    rounded-lg
                    bg-white
                    dark:bg-gray-800
                    text-gray-900
                    dark:text-gray-100
                    focus:ring-2
                    focus:ring-primary
                    focus:border-transparent
                  "
                  placeholder={isRTL ? 'افصل الوسوم بفواصل' : 'Separate tags with commas'}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {isRTL ? 'مثال: إسلام، محاضرة، قرآن' : 'e.g., Islamic, Lecture, Quran'}
                </p>
              </div>

              {/* Category, Visibility, Language */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="template-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'التصنيف' : 'Category'}
                  </label>
                  <ThemedSelectField
                    id="template-category"
                    data-testid="template-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as VideoCategory)}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                  >
                    <option value="">{isRTL ? 'اختر التصنيف' : 'Select category'}</option>
                    {VIDEO_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label[lang]}
                      </option>
                    ))}
                  </ThemedSelectField>
                </div>

                <div>
                  <label htmlFor="template-visibility" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'الخصوصية' : 'Visibility'}
                  </label>
                  <ThemedSelectField
                    id="template-visibility"
                    data-testid="template-visibility"
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as 'public' | 'private' | 'unlisted')}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                  >
                    <option value="public">{isRTL ? 'عام' : 'Public'}</option>
                    <option value="private">{isRTL ? 'خاص' : 'Private'}</option>
                    <option value="unlisted">{isRTL ? 'غير مدرج' : 'Unlisted'}</option>
                  </ThemedSelectField>
                </div>

                <div>
                  <label htmlFor="template-language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {isRTL ? 'اللغة' : 'Language'}
                  </label>
                  <ThemedSelectField
                    id="template-language"
                    data-testid="template-language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}
                    className="
                      w-full
                      px-4
                      py-2
                      border
                      border-gray-300
                      dark:border-gray-600
                      rounded-lg
                      bg-white
                      dark:bg-gray-800
                      text-gray-900
                      dark:text-gray-100
                      focus:ring-2
                      focus:ring-primary
                      focus:border-transparent
                    "
                  >
                    <option value="en">{isRTL ? 'إنجليزي' : 'English'}</option>
                    <option value="ar">{isRTL ? 'عربي' : 'Arabic'}</option>
                  </ThemedSelectField>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <button
              type="button"
              onClick={onClose}
              data-testid="template-editor-cancel"
              className="
                px-6
                py-2
                text-sm
                font-medium
                text-gray-700
                dark:text-gray-300
                bg-white
                dark:bg-gray-700
                border
                border-gray-300
                dark:border-gray-600
                rounded-lg
                hover:bg-gray-50
                dark:hover:bg-gray-600
                transition-colors
              "
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="template-editor-save"
              className="
                flex
                items-center
                gap-2
                px-6
                py-2
                text-sm
                font-medium
                text-white
                bg-primary
                hover:bg-primary/90
                rounded-lg
                transition-colors
                disabled:opacity-50
                disabled:cursor-not-allowed
              "
            >
              <Save className="w-4 h-4" />
              {saving ? (isRTL ? 'جاري الحفظ...' : 'Saving...') : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
