import type { ReactNode } from 'react';
import { Channel } from '@al-ummah/shared-types';

export interface ChannelCardProps {
  channel: Channel;
  onEdit: (channel: Channel) => void;
  onDelete: (channelId: string) => void;
  onView: (channelId: string) => void;
  lang?: 'en' | 'ar';
}

export interface CreateChannelCardProps {
  onClick: () => void;
  lang?: 'en' | 'ar';
}

export interface ChannelGridProps {
  channels: Channel[];
  onEdit: (channel: Channel) => void;
  onDelete: (channelId: string) => void;
  onView: (channelId: string) => void;
  /** Absent when the user may not create channels (no creator tier, or the tier's channel limit) */
  onCreate?: () => void;
  isLoading?: boolean;
  lang?: 'en' | 'ar';
}

export interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns false when submission was paused (e.g. terms_required) so the form stays open with its typed values. */
  onSubmit: (data: CreateChannelFormData) => Promise<boolean | void>;
  /** A field changed: what was refused before is not what the form says now. */
  onEdit?: () => void;
  isLoading?: boolean;
  lang?: 'en' | 'ar';
  /** Said above the buttons (what keeps the last try from finishing). */
  notice?: ReactNode;
}

export interface CreateChannelFormData {
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
}

export interface ChannelManagementSectionProps {
  className?: string;
  /** Channels loaded on the server (profile page): rendered without a client fetch */
  initialChannels?: Channel[];
}
