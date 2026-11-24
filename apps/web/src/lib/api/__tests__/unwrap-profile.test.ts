import { unwrapProfile } from '../profiles-utils';

const profile = { id: 'usr_1', email: 'a@example.com', firstName: 'Amina' };

describe('unwrapProfile', () => {
  it('reads every answer shape', () => {
    expect(unwrapProfile({ success: true, result: { profile } })).toEqual(profile);
    expect(unwrapProfile({ profile })).toEqual(profile);
    expect(unwrapProfile(profile)).toEqual(profile);
  });

  it('a profile without an email is still a profile, wrapped or not', () => {
    const { email: _email, ...none } = profile;
    expect(unwrapProfile(none)).toEqual(none);
    expect(unwrapProfile({ success: true, result: { profile: none } })).toEqual(none);
    expect(unwrapProfile({ profile: none })).toEqual(none);
  });

  it('is null when there is no profile', () => {
    for (const answer of [null, undefined, 'x', {}, { success: false, error: 'no' }, { success: true, id: 'req_1' }, { success: true, result: {} }, { profile: null }, { success: true, result: { profile: null } }]) {
      expect(unwrapProfile(answer)).toBeNull();
    }
  });
});
