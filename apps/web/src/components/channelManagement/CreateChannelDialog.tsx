import { logger } from '@/lib/logger-client';
import React, { useState } from 'react';
import { CreateChannelDialogProps, CreateChannelFormData } from './types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/**
 * CreateChannelDialog Component
 * Form dialog for creating a new channel
 * Supports both English and Arabic languages
 */
export const CreateChannelDialog: React.FC<CreateChannelDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  lang = 'en',
}) => {
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>(lang);
  const [formData, setFormData] = useState<CreateChannelFormData>({
    name: '',
    nameLocalized: { en: '', ar: '' },
    description: '',
    descriptionLocalized: { en: '', ar: '' },
  });
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  // Translations
  const translations = {
    en: {
      title: 'Create New Channel',
      description: 'Create a new channel to start sharing your content. You can customize it later.',
      channelName: 'Channel Name',
      channelNamePlaceholder: 'Enter channel name',
      descriptionLabel: 'Description (Optional)',
      descriptionPlaceholder: 'Describe your channel and what viewers can expect',
      charactersCount: 'characters',
      cancel: 'Cancel',
      create: 'Create Channel',
      creating: 'Creating...',
      required: 'Channel name is required',
      minLength: 'Channel name must be at least 3 characters',
      maxLength: 'Channel name must be less than 50 characters',
      descMaxLength: 'Description must be less than 500 characters',
    },
    ar: {
      title: 'إنشاء قناة جديدة',
      description: 'أنشئ قناة جديدة لبدء مشاركة محتواك. يمكنك تخصيصها لاحقاً.',
      channelName: 'اسم القناة',
      channelNamePlaceholder: 'أدخل اسم القناة',
      descriptionLabel: 'الوصف (اختياري)',
      descriptionPlaceholder: 'صف قناتك وما يمكن أن يتوقعه المشاهدون',
      charactersCount: 'حرف',
      cancel: 'إلغاء',
      create: 'إنشاء القناة',
      creating: 'جارٍ الإنشاء...',
      required: 'اسم القناة مطلوب',
      minLength: 'يجب أن يكون اسم القناة 3 أحرف على الأقل',
      maxLength: 'يجب أن يكون اسم القناة أقل من 50 حرفاً',
      descMaxLength: 'يجب أن يكون الوصف أقل من 500 حرف',
    },
  };

  const t = translations[lang];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const newErrors: { name?: string; description?: string } = {};
    const nameEn = formData.nameLocalized?.en || '';

    if (!nameEn.trim()) {
      newErrors.name = t.required;
    } else if (nameEn.length < 3) {
      newErrors.name = t.minLength;
    } else if (nameEn.length > 50) {
      newErrors.name = t.maxLength;
    }

    const descriptionEn = formData.descriptionLocalized?.en || '';
    if (descriptionEn && descriptionEn.length > 500) {
      newErrors.description = t.descMaxLength;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Validation targets the English fields; show that tab so the error is visible
      // (Arabic users start on the Arabic tab, where it was previously hidden)
      setActiveTab('en');
      logger.warn('CreateChannelDialog: Validation failed', { fields: Object.keys(newErrors) });
      return;
    }

    // Submit with properly formatted data
    try {
      await onSubmit({
        name: nameEn,
        nameLocalized: {
          en: nameEn,
          ar: formData.nameLocalized?.ar || ''
        },
        description: descriptionEn,
        descriptionLocalized: {
          en: descriptionEn,
          ar: formData.descriptionLocalized?.ar || ''
        }
      });
      // Reset form on success
      setFormData({
        name: '',
        nameLocalized: { en: '', ar: '' },
        description: '',
        descriptionLocalized: { en: '', ar: '' }
      });
      setErrors({});
      onOpenChange(false);
    } catch (error) {
      logger.error('Error submitting channel:', error);
    }
  };

  const handleCancel = () => {
    // Reset form on cancel
    setFormData({
      name: '',
      nameLocalized: { en: '', ar: '' },
      description: '',
      descriptionLocalized: { en: '', ar: '' }
    });
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>
              {t.description}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Language Tabs */}
            <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setActiveTab('en')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === 'en'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ar')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === 'ar'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                العربية
              </button>
            </div>

            {/* Channel Name */}
            <div className="grid gap-2">
              <label
                htmlFor={`channel-name-${activeTab}`}
                className="text-sm font-medium text-gray-900 dark:text-white"
              >
                {t.channelName} {activeTab === 'en' && <span className="text-red-500">*</span>}
              </label>
              {activeTab === 'en' && (
                <Input
                  id="channel-name-en"
                  type="text"
                  placeholder="Channel name in English"
                  value={formData.nameLocalized?.en || ''}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      name: e.target.value,
                      nameLocalized: { ...formData.nameLocalized, en: e.target.value }
                    });
                    setErrors({ ...errors, name: undefined });
                  }}
                  disabled={isLoading}
                  className={errors.name ? 'border-red-500 focus-visible:ring-red-500' : ''}
                />
              )}
              {activeTab === 'ar' && (
                <Input
                  id="channel-name-ar"
                  type="text"
                  placeholder="اسم القناة بالعربية"
                  value={formData.nameLocalized?.ar || ''}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      nameLocalized: { ...formData.nameLocalized, ar: e.target.value }
                    });
                  }}
                  disabled={isLoading}
                  dir="rtl"
                />
              )}
              {errors.name && activeTab === 'en' && (
                <p role="alert" data-testid="create-channel-name-error" className="text-sm text-red-600 dark:text-red-400">{errors.name}</p>
              )}
            </div>

            {/* Channel Description */}
            <div className="grid gap-2">
              <label
                htmlFor={`channel-description-${activeTab}`}
                className="text-sm font-medium text-gray-900 dark:text-white"
              >
                {t.descriptionLabel}
              </label>
              {activeTab === 'en' && (
                <>
                  <Textarea
                    id="channel-description-en"
                    placeholder="Describe your channel in English"
                    value={formData.descriptionLocalized?.en || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        description: e.target.value,
                        descriptionLocalized: { ...formData.descriptionLocalized, en: e.target.value }
                      });
                      setErrors({ ...errors, description: undefined });
                    }}
                    disabled={isLoading}
                    rows={4}
                    className={errors.description ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  <div className="flex justify-between items-center">
                    {errors.description ? (
                      <p className="text-sm text-red-600 dark:text-red-400">{errors.description}</p>
                    ) : (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formData.descriptionLocalized?.en?.length || 0}/500 {t.charactersCount}
                      </span>
                    )}
                  </div>
                </>
              )}
              {activeTab === 'ar' && (
                <>
                  <Textarea
                    id="channel-description-ar"
                    placeholder="وصف قناتك بالعربية"
                    value={formData.descriptionLocalized?.ar || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        descriptionLocalized: { ...formData.descriptionLocalized, ar: e.target.value }
                      });
                    }}
                    disabled={isLoading}
                    rows={4}
                    dir="rtl"
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {formData.descriptionLocalized?.ar?.length || 0}/500 {t.charactersCount}
                  </span>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <svg
                    className={lang === 'ar' ? 'animate-spin ml-2 h-4 w-4 text-white' : 'animate-spin -ml-1 mr-2 h-4 w-4 text-white'}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t.creating}
                </>
              ) : (
                t.create
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
