/**
 * LiveStreamCard Component Types
 * Task 1.3: LiveStreamCard Component (English/LTR)
 */

import { LiveStream } from '@al-ummah/shared-types';

export interface LiveStreamCardProps {
  stream: LiveStream;
  variant?: 'default' | 'compact' | 'featured';
  showChannel?: boolean;
  showViewers?: boolean;
  onPlay?: () => void;
  className?: string;
  priority?: boolean; // Image loading priority
}

export interface LiveStreamCardSkeletonProps {
  variant?: 'default' | 'compact' | 'featured';
  className?: string;
}

export type { LiveStream };
