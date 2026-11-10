import { decodeJwtPayload } from './token-refresh';

/**
 * `properties.roles` of a session's access token, or [] (never throws). The token was verified when
 * the session was made; this is for UI hints only (e.g. a Scholar's "Write article" link). Every app
 * checks roles itself.
 */
export function sessionRoles(accessToken: string | undefined | null): string[] {
  const props = decodeJwtPayload(accessToken)?.properties as { roles?: unknown } | undefined;
  return Array.isArray(props?.roles) ? props.roles.filter((r): r is string => typeof r === 'string') : [];
}
