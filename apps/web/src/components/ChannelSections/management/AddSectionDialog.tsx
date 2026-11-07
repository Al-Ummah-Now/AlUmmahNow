'use client';

import { useState } from 'react';
import { ChannelSectionType, ChannelSectionCreateInput } from '@al-ummah/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { SectionForm } from './SectionForm';
import { useLanguage } from '@/hooks/useLanguage';

interface AddSectionDialogProps {
  channelId: string;
  onAdd: (section: ChannelSectionCreateInput) => void | Promise<void>;
  disabled?: boolean;
}

export const SECTION_TYPES: ChannelSectionType[] = [
  'featured_videos',
  'recent_uploads',
  'popular_uploads',
  'single_playlist',
  'multiple_playlists',
  'subscribed_channels',
  'liked_videos',
];

export function AddSectionDialog({ channelId, onAdd, disabled }: AddSectionDialogProps) {
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ChannelSectionType | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSelectedType(null);
      setIsCreating(false);
    }
  };

  const handleFormSubmit = async (data: ChannelSectionCreateInput) => {
    setIsCreating(true);
    try {
      await onAdd(data);
      handleOpenChange(false);
    } catch (_error) {
      // Error already logged and shown by the parent page
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full h-11 md:h-10 text-sm md:text-base"
          disabled={disabled}
          data-testid="add-section-button"
        >
          <Plus className="w-4 h-4 me-2" />
          {s.addSection}
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-2xl max-h-[85vh] md:max-h-[80vh] overflow-y-auto p-4 md:p-6"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle className="text-lg md:text-xl">
            {selectedType ? s.configureSection : s.addChannelSection}
          </DialogTitle>
        </DialogHeader>

        {!selectedType ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 mt-4" data-testid="section-type-options">
            {SECTION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-section-type={type}
                onClick={() => setSelectedType(type)}
                className="p-3 md:p-4 text-start border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:border-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 active:scale-[0.98]"
              >
                <div className="font-medium text-sm md:text-base text-gray-900 dark:text-gray-100">
                  {s.typeLabels[type]}
                </div>
                <div className="text-xs md:text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {s.typeDescriptions[type]}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <SectionForm
              channelId={channelId}
              sectionType={selectedType}
              onSubmit={handleFormSubmit}
              onCancel={() => setSelectedType(null)}
              isLoading={isCreating}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
