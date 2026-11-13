/**
 * api-videos side of PostV2 (packages/shared-types/src/post-schema.ts, wiki AUN-SCHOLAR-SITES §6.3):
 * where post images may come from, and the error text for a refused field.
 */
import type { PostFieldError } from '@al-ummah/shared-types';

/**
 * Images in a post (covers, cards, link previews, image posts) come from the platform's own media
 * hosts: community uploads (images.alummahnow.net) and the CMS's media (cms.alummahnow.net and its
 * QA/stage hosts), so a post never makes viewers load a third-party image. Outside production and
 * stage, `*.test` and localhost hosts are allowed too (local stack, unit tests).
 */
export function platformMediaHost(env: unknown): (host: string) => boolean {
	const e = (env ?? {}) as { ENVIRONMENT?: string };
	const strict = e.ENVIRONMENT === 'production' || e.ENVIRONMENT === 'stage';
	return (host) => {
		const h = host.toLowerCase();
		if (h === 'alummahnow.net' || h.endsWith('.alummahnow.net')) return true;
		return !strict && (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.test'));
	};
}

const MESSAGES: Record<PostFieldError['error'], string> = {
	bad_kind: 'Unknown post type',
	required: 'This field is required',
	too_long: 'This field is too long',
	too_many: 'Too many items',
	bad_url: 'Enter a valid web address',
	bad_media: 'Images must be uploaded first',
	alt_required: 'Every card needs alt text',
	bad_value: 'This value is not allowed',
};

/** A short English message for logs and API clients; Studio shows its own text from `code`. */
export const postFieldsMessage = (e: PostFieldError) => `${MESSAGES[e.error]} (${e.field})`;
