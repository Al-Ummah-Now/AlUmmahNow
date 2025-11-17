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
  onCreate: () => void;
  isLoading?: boolean;
  lang?: 'en' | 'ar';
}

export interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateChannelFormData) => Promise<void>;
  isLoading?: boolean;
  lang?: 'en' | 'ar';
}

export interface CreateChannelFormData {
  name: string;
  description?: string;
}

export interface ChannelManagementSectionProps {
  className?: string;
}
