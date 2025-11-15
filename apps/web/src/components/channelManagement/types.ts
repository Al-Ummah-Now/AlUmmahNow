import { Channel } from '@al-ummah/shared-types';

export interface ChannelCardProps {
  channel: Channel;
  onEdit: (channel: Channel) => void;
  onDelete: (channelId: string) => void;
  onView: (channelId: string) => void;
}

export interface CreateChannelCardProps {
  onClick: () => void;
}

export interface ChannelGridProps {
  channels: Channel[];
  onEdit: (channel: Channel) => void;
  onDelete: (channelId: string) => void;
  onView: (channelId: string) => void;
  onCreate: () => void;
  isLoading?: boolean;
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
