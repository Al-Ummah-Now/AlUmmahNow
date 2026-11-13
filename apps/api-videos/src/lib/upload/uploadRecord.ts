/**
 * The video record an upload creates, the same for single and bulk uploads
 * (2026-11-10: bulk records had a Bunny thumbnail URL that 404'd until
 * encoding finished and showed up differently from single uploads).
 *
 * - uploadStatus 'uploading'; listed only to the owner until it is ready
 *   (lib/visibility.ts), then everywhere at once.
 * - No thumbnail URL until one exists: the processing check sets Bunny's auto
 *   thumbnail once the video plays and the image answers (lib/processing).
 *   A custom thumbnail uploaded with the video is kept.
 * - playUrl on the library's CDN host and bunnyLibraryId, so every later
 *   Bunny call (processing check, delete, signing) uses that library.
 */
import type { z } from 'zod';
import type { Video as BusinessVideo } from '../types';

type VideoRecord = z.infer<typeof BusinessVideo>;

export interface UploadRecordInput {
	videoId: string;
	title: string;
	description?: string;
	userId: string;
	/** A channel member who uploaded on the owner's behalf (userId is the owner) */
	uploadedBy?: string;
	channelId: string;
	isPublic?: boolean;
	/** Open to anyone with the link, never listed (only with isPublic false) */
	isUnlisted?: boolean;
	/** Comma-separated, as the upload forms send them */
	tags?: string;
	titleLocalized?: Record<string, string>;
	descriptionLocalized?: Record<string, string>;
	category?: VideoRecord['category'];
	/** Who chose the category ('uploader' when the form sent one; AI suggestions are set later) */
	categorySource?: 'uploader';
	/** Uploader's choice: 'short' or 'video'; 'auto' (or unset) leaves it to the Short rule at ready */
	format?: string;
	fileSize?: number;
	mimeType?: string;
	/** Primary language of the video, as set on upload */
	language?: 'en' | 'ar' | 'ur' | 'fr';
	commentSettings?: 'on' | 'held' | 'off';
	/** The file's name as picked (bulk rename's {filename}) */
	originalFilename?: string;
	/** A thumbnail stored with the upload (image storage), if any */
	customThumbnail?: { url: string; type: 'auto' | 'custom'; sizes?: Record<string, string> };
	/** CDN host of the Bunny library the video is uploaded to */
	bunnyHostname: string;
	/** Bunny library the video is uploaded to (lib/bunny/libraries.ts) */
	bunnyLibraryId?: number;
	now?: Date;
}

export function createUploadRecord(input: UploadRecordInput): VideoRecord {
	const at = (input.now ?? new Date()).toISOString();
	const thumbnail = input.customThumbnail?.url ? input.customThumbnail : null;
	return {
		id: input.videoId,
		title: input.title,
		description: input.description || '',
		userId: input.userId,
		...(input.uploadedBy ? { uploadedBy: input.uploadedBy } : {}),
		channelId: input.channelId,
		...(Number.isFinite(input.bunnyLibraryId) ? { bunnyLibraryId: input.bunnyLibraryId } : {}),
		playUrl: `https://${input.bunnyHostname}/${input.videoId}/playlist.m3u8`,
		thumbnailType: thumbnail?.type ?? 'auto',
		...(thumbnail ? { thumbnailUrl: thumbnail.url } : {}),
		...(thumbnail?.sizes ? { thumbnailSizes: thumbnail.sizes } : {}),
		dateCreated: at,
		dateModified: at,
		views: 0,
		availableResolutions: [],
		comments: [],
		likes: [],
		dislikes: [],
		isPublic: input.isPublic ?? true,
		...(input.isPublic === false && input.isUnlisted ? { isUnlisted: true } : {}),
		isLive: false,
		tags: input.tags ? input.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
		...(input.titleLocalized ? { titleLocalized: input.titleLocalized } : {}),
		...(input.descriptionLocalized ? { descriptionLocalized: input.descriptionLocalized } : {}),
		...(input.category ? { category: input.category } : {}),
		...(input.category && input.categorySource ? { categorySource: input.categorySource } : {}),
		...(input.format && input.format !== 'auto' ? { format: input.format } : {}),
		uploadStatus: 'uploading',
		...(input.fileSize ? { fileSize: input.fileSize } : {}),
		...(input.mimeType ? { originalFormat: input.mimeType } : {}),
		...(input.language ? { language: input.language } : {}),
		...(input.commentSettings ? { commentSettings: input.commentSettings } : {}),
		...(input.originalFilename ? { originalFilename: input.originalFilename } : {}),
	} as VideoRecord;
}
