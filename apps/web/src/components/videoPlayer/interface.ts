

export interface PlayerOptions {
  id: string;
  title: string;
  channel: string;
  channelAvatar: string;
  description: string;
  views: string;
  url: string;
  autoplay: boolean;
  type: string;
  width?: number;
  height?: number;
  availableResolutions?: string[];
  dateCreated: Date;
}
