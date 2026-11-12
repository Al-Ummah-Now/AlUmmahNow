'use client';

/**
 * Upload Defaults Settings Page
 *
 * Allows users to manage their upload templates.
 * Displays list of templates with actions: edit, delete, set as default.
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  Plus,
  Star,
  Edit2,
  Trash2,
  MoreVertical,
  FileText,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { UploadTemplate, VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import { listTemplates, deleteTemplate, setDefaultTemplate } from '@/lib/api/upload-defaults';
import { TemplateEditorModal } from '@/components/settings/TemplateEditorModal';
import { parseTemplateListResponse } from '@/lib/upload/template-list';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { logger } from '@/lib/logger-client';

export default function UploadDefaultsPage() {
  const { t, isRTL } = useLanguage();

  // State
  const [templates, setTemplates] = useState<UploadTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<UploadTemplate | undefined>(undefined);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  // Failure of a delete / set-default action, shown inline
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Load templates
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await listTemplates();
      if (response) {
        // The API wraps the list in `result`; reading `response.templates` always showed the empty state
        const parsed = parseTemplateListResponse(response);
        setTemplates(parsed.templates);
        setDefaultTemplateId(parsed.defaultTemplateId);
      } else {
        // API returned null - set empty array and show error
        setTemplates([]);
        setError(isRTL ? 'فشل في تحميل القوالب' : 'Failed to load templates');
      }
    } catch (_err) {
      // Exception occurred - set empty array and show error
      setTemplates([]);
      setError(isRTL ? 'حدث خطأ أثناء التحميل' : 'An error occurred while loading');
    } finally {
      setLoading(false);
    }
  }, [isRTL]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Handle create template
  const handleCreate = () => {
    setEditingTemplate(undefined);
    setModalMode('create');
    setIsModalOpen(true);
  };

  // Handle edit template
  const handleEdit = (template: UploadTemplate) => {
    setEditingTemplate(template);
    setModalMode('edit');
    setIsModalOpen(true);
    setActiveMenu(null);
  };

  // Handle delete template
  const handleDelete = async (template: UploadTemplate) => {
    // Close the actions menu first; it stayed open through the reload otherwise
    setActiveMenu(null);
    setActionError(null);
    const confirmed = await confirm({
      title: t.confirmDialog.deleteTemplateTitle,
      description: t.uploadDefaults?.confirmDelete,
      confirmLabel: t.common.delete,
      testId: 'template-delete-dialog',
    });
    if (!confirmed) return;

    try {
      const result = await deleteTemplate(template.id);
      if (result?.success) {
        await loadTemplates();
      } else {
        setActionError(t.confirmDialog.deleteTemplateFailed);
      }
    } catch (err) {
      logger.error('[UploadDefaults] Delete template failed', { templateId: template.id, error: err });
      setActionError(t.confirmDialog.deleteTemplateFailed);
    }
  };

  // Handle set as default
  const handleSetDefault = async (templateId: string) => {
    setActiveMenu(null);
    setActionError(null);
    try {
      const result = await setDefaultTemplate(templateId);
      if (result?.success) {
        // Show the new default right away; the reload below confirms it
        setDefaultTemplateId(templateId);
        await loadTemplates();
      } else {
        setActionError(t.confirmDialog.setDefaultTemplateFailed);
      }
    } catch (err) {
      logger.error('[UploadDefaults] Set default template failed', { templateId, error: err });
      setActionError(t.confirmDialog.setDefaultTemplateFailed);
    }
    setActiveMenu(null);
  };

  // Handle modal success
  const handleModalSuccess = () => {
    loadTemplates();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'} data-testid="upload-defaults-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {isRTL ? 'قوالب الرفع' : 'Upload Defaults'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {isRTL
              ? 'أنشئ قوالب لتوفير الوقت عند رفع مقاطع الفيديو. يمكنك استخدام المتغيرات لتعبئة البيانات تلقائيًا.'
              : 'Create templates to save time when uploading videos. Use variables to auto-fill metadata.'}
          </p>
        </div>

        {/* Create Button */}
        <div className="mb-6">
          <button
            type="button"
            onClick={handleCreate}
            data-testid="template-create"
            className="
              flex
              items-center
              gap-2
              px-4
              py-2.5
              bg-primary
              text-primary-foreground
              hover:bg-primary/90
              rounded-lg
              font-medium
              shadow-sm
              hover:shadow-md
              transition-all
              duration-200
            "
          >
            <Plus className="w-5 h-5" />
            {isRTL ? 'إنشاء قالب جديد' : 'Create New Template'}
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12" role="status" aria-label={t.common.loading} data-testid="templates-loading">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}

        {confirmDialog}

        {actionError && (
          <div role="alert" data-testid="templates-action-error" className="mb-6 flex items-center gap-2 p-4 rounded-lg border border-[color-mix(in_srgb,var(--fanous-color-error-fill)_40%,transparent)] bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]">
            <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm">{actionError}</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div role="alert" data-testid="templates-error" className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && templates && templates.length === 0 && (
          <div data-testid="templates-empty" className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {isRTL ? 'لا توجد قوالب' : 'No templates yet'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {isRTL
                ? 'أنشئ قالبك الأول لتسريع عملية رفع المرئيات'
                : 'Create your first template to speed up video uploads'}
            </p>
            <button
              onClick={handleCreate}
              className="
                inline-flex
                items-center
                gap-2
                px-6
                py-3
                bg-primary
                text-primary-foreground
                hover:bg-primary/90
                rounded-lg
                font-medium
                shadow-md
                hover:shadow-lg
                transition-all
                duration-200
              "
            >
              <Plus className="w-5 h-5" />
              {isRTL ? 'إنشاء القالب الأول' : 'Create First Template'}
            </button>
          </div>
        )}

        {/* Templates List */}
        {!loading && !error && templates && templates.length > 0 && (
          <div data-testid="templates-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => {
              const isDefault = template.id === defaultTemplateId;

              return (
                <div
                  key={template.id}
                  data-testid="template-card"
                  data-template-id={template.id}
                  data-default={isDefault ? 'true' : 'false'}
                  className="
                    relative
                    bg-white
                    dark:bg-gray-800
                    rounded-lg
                    border
                    border-gray-200
                    dark:border-gray-700
                    hover:border-primary/50
                    dark:hover:border-primary/50
                    transition-all
                  "
                >
                  {/* No overflow-hidden on the card: it clipped the actions menu below
                      the buttons, so "Set as Default" / "Delete" could not be clicked */}
                  {/* Default Badge */}
                  {isDefault && (
                    <div className="absolute top-3 end-3" data-testid="template-default-badge">
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-brand-soft dark:bg-brand-soft text-brand-ink dark:text-brand-ink">
                        <Star className="w-3 h-3 fill-current" />
                        <span className="text-xs font-medium">
                          {isRTL ? 'افتراضي' : 'Default'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="p-6">
                    {/* Template Name */}
                    <h3 data-testid="template-name" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 pe-20">
                      {isRTL
                        ? template.nameLocalized?.ar || template.name
                        : template.name}
                    </h3>

                    {/* Template Description */}
                    {template.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">
                        {template.description}
                      </p>
                    )}

                    {/* Template Details */}
                    <div className="space-y-2 mb-4">
                      {template.template.category && (
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="font-medium">{isRTL ? 'التصنيف:' : 'Category:'}</span>
                          <span data-testid="template-category">{VIDEO_CATEGORIES.find((c) => c.value === template.template.category)?.label[isRTL ? 'ar' : 'en'] ?? template.template.category}</span>
                        </div>
                      )}
                      {template.template.tags && template.template.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {template.template.tags.slice(0, 3).map((tag, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                            >
                              {tag}
                            </span>
                          ))}
                          {template.template.tags.length > 3 && (
                            <span className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                              +{template.template.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">{isRTL ? 'استخدمت:' : 'Used:'}</span>
                        <span>
                          {template.usageCount || 0} {isRTL ? 'مرة' : 'times'}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="template-edit"
                        onClick={() => handleEdit(template)}
                        className="
                          flex-1
                          flex
                          items-center
                          justify-center
                          gap-2
                          px-4
                          py-2
                          text-sm
                          font-medium
                          bg-secondary
                          text-secondary-foreground
                          hover:bg-secondary/80
                          border
                          border-border
                          rounded-lg
                          shadow-xs
                          transition-all
                          duration-200
                        "
                      >
                        <Edit2 className="w-4 h-4" />
                        {t.common.edit}
                      </button>

                      {/* More Actions Menu */}
                      <div className="relative">
                        <button
                          type="button"
                          data-testid="template-menu"
                          aria-label={isRTL ? 'المزيد من الإجراءات' : 'More actions'}
                          aria-haspopup="menu"
                          aria-expanded={activeMenu === template.id}
                          onClick={() => setActiveMenu(activeMenu === template.id ? null : template.id)}
                          className="
                            p-2
                            bg-secondary
                            text-secondary-foreground
                            hover:bg-secondary/80
                            border
                            border-border
                            rounded-lg
                            shadow-xs
                            transition-all
                            duration-200
                          "
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeMenu === template.id && (
                          <>
                            {/* Backdrop */}
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setActiveMenu(null)}
                            />

                            {/* Menu */}
                            <div role="menu" className="
                              absolute
                              end-0
                              mt-2
                              w-48
                              bg-popover
                              text-popover-foreground
                              rounded-lg
                              shadow-lg
                              border
                              border-border
                              py-1
                              z-20
                            ">
                              {!isDefault && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  data-testid="template-set-default"
                                  onClick={() => handleSetDefault(template.id)}
                                  className="
                                    w-full
                                    flex
                                    items-center
                                    gap-2
                                    px-4
                                    py-2
                                    text-sm
                                    text-foreground
                                    hover:bg-accent
                                    hover:text-accent-foreground
                                    transition-all
                                    duration-150
                                  "
                                >
                                  <Star className="w-4 h-4" />
                                  {isRTL ? 'تعيين كافتراضي' : 'Set as Default'}
                                </button>
                              )}
                              <button
                                type="button"
                                role="menuitem"
                                data-testid="template-delete"
                                onClick={() => handleDelete(template)}
                                className="
                                  w-full
                                  flex
                                  items-center
                                  gap-2
                                  px-4
                                  py-2
                                  text-sm
                                  text-destructive
                                  hover:bg-destructive/10
                                  dark:hover:bg-destructive/20
                                  transition-all
                                  duration-150
                                "
                              >
                                <Trash2 className="w-4 h-4" />
                                {t.common.delete}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Template Editor Modal */}
      <TemplateEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        template={editingTemplate}
        mode={modalMode}
      />
    </div>
  );
}
