/**
 * Mock data for scheduled videos testing
 */

export const mockScheduledVideos = [
  {
    id: 'video-1',
    title: 'Introduction to Islamic History',
    description: 'A comprehensive overview of Islamic history from the beginning',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-1.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-1.mp4',
    scheduledPublishDate: '2025-02-15T10:00:00Z',
    scheduledPublishTimezone: 'America/New_York',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-1',
    userId: 'user-1',
    duration: 3600,
    views: 0,
    likes: 0,
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
  },
  {
    id: 'video-2',
    title: 'القرآن الكريم - سورة البقرة',
    description: 'تلاوة سورة البقرة كاملة',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-2.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-2.mp4',
    scheduledPublishDate: '2025-02-20T14:30:00Z',
    scheduledPublishTimezone: 'Asia/Riyadh',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-2',
    userId: 'user-2',
    duration: 7200,
    views: 0,
    likes: 0,
    createdAt: '2025-01-20T10:00:00Z',
    updatedAt: '2025-01-20T10:00:00Z',
  },
  {
    id: 'video-3',
    title: 'Ramadan Reflections - Day 1',
    description: 'Daily reflections during Ramadan',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-3.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-3.mp4',
    scheduledPublishDate: '2025-03-01T18:00:00Z',
    scheduledPublishTimezone: 'Europe/London',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-1',
    userId: 'user-1',
    duration: 1800,
    views: 0,
    likes: 0,
    createdAt: '2025-02-01T10:00:00Z',
    updatedAt: '2025-02-01T10:00:00Z',
  },
  {
    id: 'video-4',
    title: 'Fiqh of Prayer - Part 1',
    description: 'Understanding the fundamentals of Islamic prayer',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-4.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-4.mp4',
    scheduledPublishDate: '2025-02-16T09:00:00Z',
    scheduledPublishTimezone: 'America/New_York',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-3',
    userId: 'user-3',
    duration: 2400,
    views: 0,
    likes: 0,
    createdAt: '2025-01-16T10:00:00Z',
    updatedAt: '2025-01-16T10:00:00Z',
  },
  {
    id: 'video-5',
    title: 'Published Video - Already Live',
    description: 'This video was scheduled but is now published',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-5.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-5.mp4',
    scheduledPublishDate: '2025-01-01T00:00:00Z',
    scheduledPublishTimezone: 'UTC',
    scheduledPublishStatus: 'published' as const,
    channelId: 'channel-1',
    userId: 'user-1',
    duration: 3000,
    views: 1500,
    likes: 120,
    createdAt: '2024-12-01T10:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'video-6',
    title: 'Same Day Video - Morning',
    description: 'Multiple videos scheduled on the same day - morning slot',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-6.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-6.mp4',
    scheduledPublishDate: '2025-02-15T08:00:00Z',
    scheduledPublishTimezone: 'America/New_York',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-1',
    userId: 'user-1',
    duration: 1200,
    views: 0,
    likes: 0,
    createdAt: '2025-01-15T08:00:00Z',
    updatedAt: '2025-01-15T08:00:00Z',
  },
  {
    id: 'video-7',
    title: 'Same Day Video - Evening',
    description: 'Multiple videos scheduled on the same day - evening slot',
    thumbnailUrl: 'https://cdn.example.com/thumbnails/video-7.jpg',
    videoUrl: 'https://cdn.example.com/videos/video-7.mp4',
    scheduledPublishDate: '2025-02-15T20:00:00Z',
    scheduledPublishTimezone: 'America/New_York',
    scheduledPublishStatus: 'scheduled' as const,
    channelId: 'channel-2',
    userId: 'user-2',
    duration: 1500,
    views: 0,
    likes: 0,
    createdAt: '2025-01-15T09:00:00Z',
    updatedAt: '2025-01-15T09:00:00Z',
  },
];

export const mockEmptyScheduledVideos: typeof mockScheduledVideos = [];

// Helper to filter scheduled videos
export const getScheduledOnly = () =>
  mockScheduledVideos.filter((v) => v.scheduledPublishStatus === 'scheduled');

export const getPublishedOnly = () =>
  mockScheduledVideos.filter((v) => v.scheduledPublishStatus === 'published');

// Helper to get videos by date range
export const getVideosByDateRange = (startDate: Date, endDate: Date) =>
  mockScheduledVideos.filter((v) => {
    const videoDate = new Date(v.scheduledPublishDate);
    return videoDate >= startDate && videoDate <= endDate;
  });

// Helper to get videos by month
export const getVideosByMonth = (year: number, month: number) => {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  return getVideosByDateRange(startDate, endDate);
};
