/**
 * Files on images.alummahnow.net (the Bunny Storage zone `ZONE`): deleting one, listing and
 * emptying a folder. Used by the purges (a deleted video's custom thumbnails, a deleted post's
 * or channel's post images; issues #699, #700) and by the CSAM takedown (lib/csam/contain.ts).
 *
 * Every call is idempotent: a file or folder that is already gone (404) counts as deleted.
 */
import { getSecret } from '../env-helpers';
import { forgetImageOwner } from '../csam/imageOwners';

export type ImageFilesEnv = { image_storage_key?: unknown; ZONE?: string; SEARCH_DB?: unknown };

const STORAGE_HOST = 'https://storage.bunnycdn.com';

/** True when the image storage zone is configured (every deployed environment). */
export function imageStorageConfigured(env: ImageFilesEnv): boolean {
	return !!env.ZONE && !!env.image_storage_key;
}

async function storageKey(env: ImageFilesEnv): Promise<string> {
	const key = env.image_storage_key ? await getSecret(env.image_storage_key, 'image_storage_key') : '';
	if (!key || !env.ZONE) throw new Error('Image storage is not configured');
	return key;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** The path of one of our image URLs (`/…`, decoded), or null for any other URL. */
export function imagePathOfUrl(url: unknown): string | null {
	if (typeof url !== 'string' || !url) return null;
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`);
		return /^images\.alummahnow\.(?:net|org)$/i.test(u.hostname) ? decodeURIComponent(u.pathname) || null : null;
	} catch {
		return null;
	}
}

/** A path that is one plain file directly under `prefix` (no dot segments, no sub-folders, no encoded separators). */
export function fileUnder(path: string, prefix: string): boolean {
	if (!path.startsWith(prefix)) return false;
	const rest = path.slice(prefix.length);
	return !!rest && !rest.includes('/') && rest !== '.' && rest !== '..' && !rest.includes('\\');
}

/** Deletes one stored file. A file that is already gone counts as done. */
export async function deleteImageFile(env: ImageFilesEnv, path: string): Promise<'deleted' | 'gone'> {
	const key = await storageKey(env);
	const res = await fetch(`${STORAGE_HOST}/${env.ZONE}${encodePath(path)}`, { method: 'DELETE', headers: { AccessKey: key } });
	if (res.status === 404) return 'gone';
	if (!res.ok) throw new Error(`Image storage delete answered ${res.status}`);
	return 'deleted';
}

/** The file paths directly in a folder (`/a/b/`); none when the folder does not exist. */
export async function listImageFolder(env: ImageFilesEnv, folder: string): Promise<string[]> {
	const dir = folder.endsWith('/') ? folder : `${folder}/`;
	const key = await storageKey(env);
	const res = await fetch(`${STORAGE_HOST}/${env.ZONE}${encodePath(dir)}`, { headers: { AccessKey: key, Accept: 'application/json' } });
	if (res.status === 404) return [];
	if (!res.ok) throw new Error(`Image storage list answered ${res.status}`);
	const items = (await res.json().catch(() => [])) as Array<{ ObjectName?: string; IsDirectory?: boolean }>;
	return (Array.isArray(items) ? items : [])
		.filter((item) => item && !item.IsDirectory && typeof item.ObjectName === 'string' && item.ObjectName)
		.map((item) => `${dir}${item.ObjectName}`)
		.filter((path) => fileUnder(path, dir));
}

/**
 * Deletes the given files and their `image_owners` rows (lib/csam/imageOwners.ts). Returns how
 * many were deleted (gone ones are not counted). Throws on the first failure, so a job retries.
 */
export async function deleteImageFiles(env: ImageFilesEnv, paths: Iterable<string>): Promise<number> {
	let deleted = 0;
	for (const path of new Set(paths)) {
		if ((await deleteImageFile(env, path)) === 'deleted') deleted++;
		await forgetImageOwner(env.SEARCH_DB as D1Database | undefined, path);
	}
	return deleted;
}

/** Empties one folder (its files; there are no sub-folders under ours). Returns how many were deleted. */
export async function deleteImageFolder(env: ImageFilesEnv, folder: string): Promise<number> {
	return deleteImageFiles(env, await listImageFolder(env, folder));
}
