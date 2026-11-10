/**
 * Which upload template is the default, kept in ONE document per scope
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-20).
 *
 * Templates used to carry their own `isDefault` flag, and "set as default"
 * listed the scope and rewrote every other flagged template without
 * conditions: two "set as default" at once left two defaults. Now the default
 * of a scope (the user's templates, or one channel's) is `defaultTemplateId`
 * in `_default/<userId>/<channelId | _user>` (same bucket, outside the
 * `<userId>/` prefix that lists templates), set with a conditional write, so
 * a scope has at most one default by construction.
 *
 * A scope without a pointer document (templates from before this change)
 * still uses the templates' own `isDefault` flags.
 */
import R2Repository from './r2Repo';

export interface DefaultPointer {
	defaultTemplateId: string | null;
	updatedAt: string;
}

interface TemplateLike {
	id: string;
	channelId?: string | null;
	isDefault?: boolean;
}

const USER_SCOPE = '_user';

export const defaultPointerPrefix = (userId: string) => `_default/${userId}/`;
export const defaultPointerKey = (userId: string, channelId?: string | null) => `${defaultPointerPrefix(userId)}${channelId || USER_SCOPE}`;

export async function readDefaultPointer(bucket: R2Bucket, userId: string, channelId?: string | null): Promise<DefaultPointer | null> {
	return new R2Repository<DefaultPointer>(bucket).getObject(defaultPointerKey(userId, channelId));
}

/** Whether `template` is its scope's default: the pointer when the scope has one, else its own flag. */
export function isDefaultTemplate(template: TemplateLike, pointer: DefaultPointer | null | undefined): boolean {
	return pointer ? pointer.defaultTemplateId === template.id : template.isDefault === true;
}

/** Makes `template` the default of its scope (one conditional write; replaces any other default). */
export async function setDefaultTemplate(bucket: R2Bucket, userId: string, template: TemplateLike): Promise<void> {
	await new R2Repository<DefaultPointer>(bucket).updateObject(
		defaultPointerKey(userId, template.channelId),
		(pointer) => {
			if (pointer.defaultTemplateId === template.id) return false;
			pointer.defaultTemplateId = template.id;
			pointer.updatedAt = new Date().toISOString();
			return true;
		},
		{ initial: () => ({ defaultTemplateId: null, updatedAt: new Date().toISOString() }) },
	);
}

/**
 * Removes `template` as its scope's default, if it is (it was unset or
 * deleted). Another template that became the default meanwhile stays.
 */
export async function clearDefaultTemplate(bucket: R2Bucket, userId: string, template: TemplateLike): Promise<void> {
	const repo = new R2Repository<DefaultPointer>(bucket);
	const key = defaultPointerKey(userId, template.channelId);
	// Legacy scope (no pointer): only a flagged template needs a pointer that says "no default"
	const initial = template.isDefault === true ? () => ({ defaultTemplateId: template.id, updatedAt: new Date().toISOString() }) : undefined;
	await repo.updateObject(
		key,
		(pointer) => {
			if (pointer.defaultTemplateId !== template.id) return false;
			pointer.defaultTemplateId = null;
			pointer.updatedAt = new Date().toISOString();
			return true;
		},
		{ initial },
	);
}

/** Pointer lookups for a page of templates, one read per scope. */
export function pointerCache(bucket: R2Bucket, userId: string) {
	const scopes = new Map<string, Promise<DefaultPointer | null>>();
	return (channelId?: string | null) => {
		const key = channelId || USER_SCOPE;
		if (!scopes.has(key)) scopes.set(key, readDefaultPointer(bucket, userId, channelId));
		return scopes.get(key)!;
	};
}
