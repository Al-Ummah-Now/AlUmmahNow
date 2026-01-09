/**
 * Chapter validation schemas
 * Zod schemas for validating chapter data
 */

import { z } from 'zod';

export const VideoChapterSchema = z.object({
  id: z.string().uuid(),
  startTime: z.number().min(0),
  endTime: z.number().min(10), // Minimum 10 seconds
  title: z.string().min(1).max(100),
  titleLocalized: z.object({
    en: z.string().optional(),
    ar: z.string().optional(),
  }).optional(),
});

export const VideoChapterDataSchema = z.object({
  chapters: z.array(VideoChapterSchema).max(100),
  source: z.enum(['automatic', 'manual', 'imported']),
  parsedAt: z.string().datetime(),
  version: z.number().default(1),
});

// Type inference
export type VideoChapterSchemaType = z.infer<typeof VideoChapterSchema>;
export type VideoChapterDataSchemaType = z.infer<typeof VideoChapterDataSchema>;
