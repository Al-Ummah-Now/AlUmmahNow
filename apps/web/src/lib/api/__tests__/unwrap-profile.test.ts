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

  it.each([
    ['a failed answer', { success: false, result: { profile } }],
    ['an empty profile', { profile: {} }],
    ['a list', { profile: [] }],
    ['a list in result', { success: true, result: { profile: [profile] } }],
    ['a list answer', [profile]],
    ['an empty id', { id: '' }],
    ['a null id', { id: null }],
    ['an empty id, wrapped', { success: true, result: { profile: { id: '' } } }],
    ['a number id', { profile: { id: 7 } }],
    ['an error with an id', { id: 'req_1', error: 'Not found' }],
    ['an error beside a profile', { error: 'Not found', profile }],
    ['an error in the profile', { profile: { id: 'req_1', error: 'Not found' } }],
  ])('is null for %s', (_name, answer) => {
    expect(unwrapProfile(answer)).toBeNull();
  });
});
