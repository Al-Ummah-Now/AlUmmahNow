/**
 * The upload page's destination channel: which channels are eligible, which
 * one the picker starts on, the per-user memory, and when changing it is
 * free, needs a confirm or is locked.
 */
import {
  channelChangeState,
  initialUploadChannel,
  requeueableRows,
  readRememberedUploadChannel,
  rememberUploadChannel,
  roleOn,
  uploadEligibleChannels,
} from '../upload-channel';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const ME = 'u-me';
const owned = { id: 'c-own', userId: ME, name: 'Mine', role: 'owner' as const, isMain: true };
const second = { id: 'c-own2', userId: ME, name: 'Mine too', isMain: false };
const editor = { id: 'c-ed', userId: 'u-other', name: 'Edited', role: 'editor' as const };
const admin = { id: 'c-adm', userId: 'u-other', name: 'Admined', role: 'admin' as const };
const moderator = { id: 'c-mod', userId: 'u-other', name: 'Moderated', role: 'moderator' as const };
const suspended = { id: 'c-sus', userId: ME, name: 'Suspended', role: 'owner' as const, isSuspended: true };

describe('uploadEligibleChannels', () => {
  it('keeps owned channels and roles that may upload, drops moderators and suspended channels', () => {
    const list = uploadEligibleChannels([owned, second, editor, admin, moderator, suspended], ME);
    expect(list.map((c) => c.id)).toEqual(['c-own', 'c-own2', 'c-ed', 'c-adm']);
  });

  it('treats an owned channel without a role as owner, and drops duplicates', () => {
    expect(roleOn(second, ME)).toBe('owner');
    expect(uploadEligibleChannels([owned, owned], ME)).toHaveLength(1);
    expect(uploadEligibleChannels(undefined, ME)).toEqual([]);
  });
});

describe('initialUploadChannel', () => {
  const eligible = [owned, second, editor];

  it('prefers an eligible ?channel= link', () => {
    expect(initialUploadChannel({ eligible, deepLinkId: 'c-ed', navChannelId: 'c-own' })).toEqual({ id: 'c-ed', source: 'link' });
  });

  it('ignores a link to a channel the user cannot upload to', () => {
    expect(initialUploadChannel({ eligible, deepLinkId: 'c-mod', navChannelId: 'c-own2' })).toEqual({ id: 'c-own2', source: 'nav' });
  });

  it('defaults to the header channel, then the session channel, then the first', () => {
    expect(initialUploadChannel({ eligible, navChannelId: 'c-own2', sessionChannelId: 'c-own' }).id).toBe('c-own2');
    expect(initialUploadChannel({ eligible, navChannelId: null, sessionChannelId: 'c-ed' })).toEqual({ id: 'c-ed', source: 'session' });
    expect(initialUploadChannel({ eligible, navChannelId: 'c-gone' })).toEqual({ id: 'c-own', source: 'first' });
    expect(initialUploadChannel({ eligible: [] })).toEqual({ id: null, source: 'none' });
  });

  it('uses the remembered pick while the header channel is unchanged; a header switch wins', () => {
    const remembered = { channelId: 'c-ed', navChannelId: 'c-own' };
    expect(initialUploadChannel({ eligible, remembered, navChannelId: 'c-own' })).toEqual({ id: 'c-ed', source: 'remembered' });
    expect(initialUploadChannel({ eligible, remembered, navChannelId: 'c-own2' })).toEqual({ id: 'c-own2', source: 'nav' });
    // The session's channel counts as the header channel when the context has none
    expect(initialUploadChannel({ eligible, remembered, navChannelId: null, sessionChannelId: 'c-own' }).id).toBe('c-ed');
  });

  it('drops a remembered channel that is no longer eligible', () => {
    expect(initialUploadChannel({ eligible, remembered: { channelId: 'c-mod', navChannelId: 'c-own' }, navChannelId: 'c-own' }).id).toBe('c-own');
  });
});

describe('remembered upload channel', () => {
  it('is stored per user', () => {
    const s = memoryStorage();
    rememberUploadChannel('a', { channelId: 'c1', navChannelId: 'c0' }, s);
    expect(readRememberedUploadChannel('a', s)).toEqual({ channelId: 'c1', navChannelId: 'c0' });
    expect(readRememberedUploadChannel('b', s)).toBeNull();
    expect(readRememberedUploadChannel(undefined, s)).toBeNull();
  });

  it('survives broken or blocked storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    expect(readRememberedUploadChannel('a', broken)).toBeNull();
    expect(() => rememberUploadChannel('a', { channelId: 'c1', navChannelId: null }, broken)).not.toThrow();
    expect(readRememberedUploadChannel('a', null)).toBeNull();
  });
});

describe('channelChangeState', () => {
  const idle = { rows: [], singleHasFile: false, singleBusy: false, singleDone: false };

  it('is free with nothing chosen', () => {
    expect(channelChangeState(idle)).toBe('free');
  });

  it('asks first when files are chosen but not started', () => {
    expect(channelChangeState({ ...idle, singleHasFile: true })).toBe('confirm');
    expect(channelChangeState({ ...idle, rows: [{ status: 'pending' }] })).toBe('confirm');
    // Adding to the batch creates the placeholder video at once: still only queued
    expect(channelChangeState({ ...idle, rows: [{ status: 'pending', videoId: 'v0', bytesUploaded: 0 }] })).toBe('confirm');
    expect(channelChangeState({ ...idle, rows: [{ status: 'completed', videoId: 'v1' }, { status: 'cancelled', videoId: 'v2' }] })).toBe('confirm');
    expect(channelChangeState({ ...idle, rows: [{ status: 'failed' }] })).toBe('confirm');
  });

  it('locks once an upload has started, never moving it', () => {
    expect(channelChangeState({ ...idle, singleBusy: true })).toBe('locked');
    expect(channelChangeState({ ...idle, singleDone: true })).toBe('locked');
    for (const status of ['initiating', 'uploading', 'paused', 'processing']) {
      expect(channelChangeState({ ...idle, rows: [{ status }] })).toBe('locked');
    }
    expect(channelChangeState({ ...idle, rows: [{ status: 'pending', videoId: 'v0', bytesUploaded: 1024 }] })).toBe('locked');
    // A failed row whose video exists still belongs to its channel
    expect(channelChangeState({ ...idle, rows: [{ status: 'failed', videoId: 'v1' }] })).toBe('locked');
  });
});

describe('requeueableRows', () => {
  it('moves only queued rows with nothing sent', () => {
    const rows = [
      { id: 'a', status: 'pending', videoId: 'v1', bytesUploaded: 0 },
      { id: 'b', status: 'pending', videoId: 'v2', bytesUploaded: 10 },
      { id: 'c', status: 'completed', videoId: 'v3', bytesUploaded: 99 },
      { id: 'd', status: 'pending' },
    ];
    expect(requeueableRows(rows).map((r) => r.id)).toEqual(['a', 'd']);
  });
});
