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
  const [formData, setFormData] = useState<CreateChannelFormData>({
    name: '',
    description: '',
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
    if (!formData.name.trim()) {
      newErrors.name = t.required;
    } else if (formData.name.length < 3) {
      newErrors.name = t.minLength;
    } else if (formData.name.length > 50) {
      newErrors.name = t.maxLength;
    }

    if (formData.description && formData.description.length > 500) {
      newErrors.description = t.descMaxLength;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Submit
    try {
      await onSubmit(formData);
      // Reset form on success
      setFormData({ name: '', description: '' });
      setErrors({});
      onOpenChange(false);
    } catch (error) {
      console.error('Error submitting channel:', error);
    }
  };

  const handleCancel = () => {
    // Reset form on cancel
    setFormData({ name: '', description: '' });
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
            {/* Channel Name */}
            <div className="grid gap-2">
              <label
                htmlFor="channel-name"
                className="text-sm font-medium text-gray-900 dark:text-white"
              >
                {t.channelName} <span className="text-red-500">*</span>
              </label>
              <Input
                id="channel-name"
                type="text"
                placeholder={t.channelNamePlaceholder}
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  setErrors({ ...errors, name: undefined });
                }}
                disabled={isLoading}
                className={errors.name ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {errors.name && (
                <p className="text-sm text-red-600 dark:text-red-400">{errors.name}</p>
              )}
            </div>

            {/* Channel Description */}
            <div className="grid gap-2">
              <label
                htmlFor="channel-description"
                className="text-sm font-medium text-gray-900 dark:text-white"
              >
                {t.descriptionLabel}
              </label>
              <Textarea
                id="channel-description"
                placeholder={t.descriptionPlaceholder}
                value={formData.description}
                onChange={(e) => {
                  setFormData({ ...formData, description: e.target.value });
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
                    {formData.description?.length || 0}/500 {t.charactersCount}
                  </span>
                )}
              </div>
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
