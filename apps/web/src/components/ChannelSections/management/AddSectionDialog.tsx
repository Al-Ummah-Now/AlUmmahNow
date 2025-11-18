'use client';

import { useState } from 'react';
import { ChannelSectionType } from '@al-ummah/shared-types';
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

interface AddSectionDialogProps {
  channelId: string;
  onAdd: (section: any) => void;
  disabled?: boolean;
}

interface SectionTypeOption {
  type: ChannelSectionType;
  label: string;
  description: string;
}

const SECTION_TYPES: SectionTypeOption[] = [
  {
    type: 'recentUploads',
    label: 'Recent uploads',
    description: 'Your latest videos',
  },
  {
    type: 'popularUploads',
    label: 'Popular uploads',
    description: 'Your most-viewed videos',
  },
  {
    type: 'allPlaylists',
    label: 'All playlists',
    description: 'All your public playlists',
  },
  {
    type: 'multiplePlaylists',
    label: 'Featured playlists',
    description: 'Specific playlists you choose',
  },
  {
    type: 'singlePlaylist',
    label: 'Single playlist',
    description: 'One featured playlist',
  },
  {
    type: 'liveEvents',
    label: 'Live now',
    description: 'Current live streams',
  },
  {
    type: 'completedEvents',
    label: 'Past live streams',
    description: 'Previous broadcasts',
  },
  {
    type: 'upcomingEvents',
    label: 'Upcoming',
    description: 'Scheduled live streams',
  },
  {
    type: 'multipleChannels',
    label: 'Featured channels',
    description: 'Channels you recommend',
  },
  {
    type: 'subscriptions',
    label: 'Subscriptions',
    description: 'Channels you subscribe to',
  },
];

export function AddSectionDialog({ channelId, onAdd, disabled }: AddSectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ChannelSectionType | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleTypeSelect = (type: ChannelSectionType) => {
    setSelectedType(type);
  };

  const handleBack = () => {
    setSelectedType(null);
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedType(null);
    setIsCreating(false);
  };

  const handleFormSubmit = async (data: any) => {
    setIsCreating(true);
    try {
      await onAdd(data);
      handleClose();
    } catch (error) {
      console.error('Error creating section:', error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="
            w-full
            h-11             /* Mobile: standard height */
            md:h-10          /* Desktop: slightly smaller */
            text-sm
            md:text-base
          "
          disabled={disabled}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add section
        </Button>
      </DialogTrigger>

      <DialogContent
        className="
          max-w-2xl
          max-h-[85vh]     /* Mobile: more space */
          md:max-h-[80vh]  /* Desktop: slightly less */
          overflow-y-auto
          p-4              /* Mobile: compact padding */
          md:p-6           /* Desktop: more padding */
        "
      >
        <DialogHeader>
          <DialogTitle className="text-lg md:text-xl">
            {selectedType ? 'Configure section' : 'Add channel section'}
          </DialogTitle>
        </DialogHeader>

        {!selectedType ? (
          // Section type selector
          <div className="
            grid
            grid-cols-1       /* Mobile: 1 column */
            sm:grid-cols-2    /* Tablet+: 2 columns */
            gap-2             /* Mobile: compact gap */
            md:gap-3          /* Desktop: more space */
            mt-4
          ">
            {SECTION_TYPES.map((option) => (
              <button
                key={option.type}
                onClick={() => handleTypeSelect(option.type)}
                className="
                  p-3               /* Mobile: compact padding */
                  md:p-4            /* Desktop: more padding */
                  text-left
                  border
                  border-gray-200
                  dark:border-gray-700
                  rounded-lg
                  hover:border-blue-500
                  hover:bg-blue-50
                  dark:hover:bg-blue-900/20
                  dark:hover:border-blue-600
                  transition-colors
                  focus:outline-none
                  focus:ring-2
                  focus:ring-blue-500
                  focus:ring-offset-2
                  dark:focus:ring-offset-gray-900
                  active:scale-[0.98]  /* Mobile: tap feedback */
                "
              >
                <div className="
                  font-medium
                  text-sm           /* Mobile: smaller text */
                  md:text-base      /* Desktop: normal text */
                  text-gray-900
                  dark:text-gray-100
                ">
                  {option.label}
                </div>
                <div className="
                  text-xs           /* Mobile: extra small */
                  md:text-sm        /* Desktop: small */
                  text-gray-600
                  dark:text-gray-400
                  mt-1
                ">
                  {option.description}
                </div>
              </button>
            ))}
          </div>
        ) : (
          // Section form
          <div className="mt-4">
            <SectionForm
              channelId={channelId}
              sectionType={selectedType}
              onSubmit={handleFormSubmit}
              onCancel={handleBack}
              isLoading={isCreating}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
