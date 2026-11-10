/** @jest-environment node */
import { sessionRoles } from '../session-roles';

const token = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('sessionRoles', () => {
  it('reads properties.roles from the access token', () => {
    expect(sessionRoles(token({ properties: { id: 'u', roles: ['Member', 'Scholar', 7] } }))).toEqual(['Member', 'Scholar']);
  });
  it('is [] for no token, a malformed token or no roles', () => {
    expect(sessionRoles(undefined)).toEqual([]);
    expect(sessionRoles('nope')).toEqual([]);
    expect(sessionRoles(token({ properties: {} }))).toEqual([]);
  });
});
