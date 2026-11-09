/** Details carried over when a failed upload is uploaded again (spec §4.4.1). */

interface RetrySource {
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string | null;
  descriptionLocalized?: Record<string, string>;
  tags?: string[];
  category?: unknown;
  isPublic?: boolean;
  isDraft?: boolean;
}

export function retryMetadata(video: RetrySource) {
  return {
    title: video.title ?? '',
    titleEn: video.titleLocalized?.en || video.title || '',
    titleAr: video.titleLocalized?.ar || '',
    description: video.description ?? '',
    descriptionEn: video.descriptionLocalized?.en || video.description || '',
    descriptionAr: video.descriptionLocalized?.ar || '',
    tags: video.tags ?? [],
    isPublic: video.isPublic !== false,
    ...(video.category ? { category: video.category } : {}),
  };
}
