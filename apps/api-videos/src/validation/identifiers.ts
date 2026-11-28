import { z } from 'zod';

/** Application IDs occupy one component in object keys, URLs and headers. */
export const RecordId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** Language tags occupy one component of a caption object's filename. */
export const SubtitleLanguage = z.string().max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
