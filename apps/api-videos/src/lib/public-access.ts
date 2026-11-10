import { isAdmin } from '@al-ummah/shared-types';
/** Admin or Super Admin (the shared role check, packages/shared-types roles.ts). */
export function isAdminRole(roles: readonly string[] | undefined | null): boolean {
	return isAdmin(roles);
}
