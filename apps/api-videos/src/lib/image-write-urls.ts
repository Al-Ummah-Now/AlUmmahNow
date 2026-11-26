import type { AppBindings } from '../base';
import { imageUploadPath, isUploadRow, lookupImageOwner } from './csam/imageOwners';
import { absoluteImageUrl } from './image-urls';

const FIELDS = ['avatarUrl', 'coverUrl', 'thumbnailUrl'] as const;
type ImageFields = Partial<Record<(typeof FIELDS)[number], string>>;

/**
 * Check image writes against the authenticated uploader. An unchanged legacy
 * value is omitted from the write so a concurrent replacement stays in place.
 */
export async function invalidImageField(
	env: Pick<AppBindings, 'SEARCH_DB' | 'MEDIA_PUBLIC_HOST'>,
	actorId: string,
	input: ImageFields,
	stored?: ImageFields | null,
): Promise<string | undefined> {
	for (const field of FIELDS) {
		const value = input[field];
		if (value === undefined) continue;
		if (!value.trim()) {
			input[field] = '';
			continue;
		}
		const previous = stored?.[field];
		if (typeof previous === 'string' && (value === previous || value === absoluteImageUrl(previous))) {
			delete input[field];
			continue;
		}
		const path = imageUploadPath(value, env.MEDIA_PUBLIC_HOST);
		const owner = path && await lookupImageOwner(env.SEARCH_DB, path);
		if (!owner || owner.ownerId !== actorId || !isUploadRow(owner.createdAt)) return field;
	}
	return undefined;
}
